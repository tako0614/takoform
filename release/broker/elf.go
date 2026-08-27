package main

import (
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
)

const (
	elfClass64        = 2
	elfDataLittle     = 1
	elfMachineAMD64   = 62
	elfProgramDynamic = 2
	elfProgramInterp  = 3
	elfProgramNote    = 4
	goBuildIDNote     = 4
)

func staticGoBuildID(raw []byte) (string, error) {
	if len(raw) < 64 || !bytes.Equal(raw[:4], []byte{0x7f, 'E', 'L', 'F'}) || raw[4] != elfClass64 || raw[5] != elfDataLittle {
		return "", errors.New("broker is not one ELF64 little-endian executable")
	}
	if binary.LittleEndian.Uint16(raw[18:20]) != elfMachineAMD64 {
		return "", errors.New("broker ELF machine is not Linux amd64")
	}
	programOffset := binary.LittleEndian.Uint64(raw[32:40])
	entrySize := uint64(binary.LittleEndian.Uint16(raw[54:56]))
	entryCount := uint64(binary.LittleEndian.Uint16(raw[56:58]))
	if entrySize < 56 || entryCount == 0 || programOffset > uint64(len(raw)) || entryCount > (uint64(len(raw))-programOffset)/entrySize {
		return "", errors.New("broker ELF program-header table is malformed")
	}
	var buildIDs [][]byte
	for index := uint64(0); index < entryCount; index++ {
		offset := programOffset + index*entrySize
		programType := binary.LittleEndian.Uint32(raw[offset : offset+4])
		if programType == elfProgramInterp || programType == elfProgramDynamic {
			return "", errors.New("broker ELF contains a dynamic-loader segment and is not statically linked")
		}
		if programType != elfProgramNote {
			continue
		}
		noteOffset := binary.LittleEndian.Uint64(raw[offset+8 : offset+16])
		noteSize := binary.LittleEndian.Uint64(raw[offset+32 : offset+40])
		if noteSize == 0 || noteOffset > uint64(len(raw)) || noteSize > uint64(len(raw))-noteOffset {
			return "", errors.New("broker ELF note segment is malformed")
		}
		notes := raw[noteOffset : noteOffset+noteSize]
		for cursor := uint64(0); cursor < uint64(len(notes)); {
			if uint64(len(notes))-cursor < 12 {
				return "", errors.New("broker ELF note header is incomplete")
			}
			nameSize := uint64(binary.LittleEndian.Uint32(notes[cursor : cursor+4]))
			descriptorSize := uint64(binary.LittleEndian.Uint32(notes[cursor+4 : cursor+8]))
			noteType := binary.LittleEndian.Uint32(notes[cursor+8 : cursor+12])
			cursor += 12
			nameEnd := cursor + nameSize
			descriptorStart := align4(nameEnd)
			descriptorEnd := descriptorStart + descriptorSize
			next := align4(descriptorEnd)
			if nameEnd > uint64(len(notes)) || descriptorStart > uint64(len(notes)) || descriptorEnd > uint64(len(notes)) || next > uint64(len(notes)) {
				return "", errors.New("broker ELF note payload is malformed")
			}
			name := notes[cursor:nameEnd]
			if noteType == goBuildIDNote && bytes.Equal(name, []byte{'G', 'o', 0, 0}) {
				if descriptorSize == 0 {
					return "", errors.New("broker Go build-id descriptor is empty")
				}
				buildIDs = append(buildIDs, bytes.Clone(notes[descriptorStart:descriptorEnd]))
			}
			cursor = next
		}
	}
	if len(buildIDs) != 1 {
		return "", fmt.Errorf("broker ELF contains %d Go build-id notes, want exactly one", len(buildIDs))
	}
	return digestBytes(buildIDs[0]), nil
}

func align4(value uint64) uint64 {
	if value > ^uint64(0)-3 {
		return ^uint64(0)
	}
	return (value + 3) &^ 3
}
