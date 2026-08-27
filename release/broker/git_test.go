package main

import "testing"

func TestMinimalGitConfigRejectsHooksAlternatesAndPromisorConfiguration(t *testing.T) {
	valid := []byte("[core]\n\trepositoryformatversion = 0\n\tfilemode = true\n\tbare = false\n\tlogallrefupdates = true\n")
	if err := validateMinimalGitConfig(valid); err != nil {
		t.Fatalf("minimal detached config was rejected: %v", err)
	}
	for name, raw := range map[string][]byte{
		"hook path": append(append([]byte{}, valid...), []byte("\thooksPath = /tmp/hooks\n")...),
		"alternate": append(append([]byte{}, valid...), []byte("[objects]\n\talternateObjectDirectories = /tmp/objects\n")...),
		"promisor":  append(append([]byte{}, valid...), []byte("[remote \"origin\"]\n\tpromisor = true\n")...),
		"include":   append(append([]byte{}, valid...), []byte("[include]\n\tpath = /tmp/config\n")...),
	} {
		t.Run(name, func(t *testing.T) {
			if err := validateMinimalGitConfig(raw); err == nil {
				t.Fatal("authority-bearing Git configuration was accepted")
			}
		})
	}
}
