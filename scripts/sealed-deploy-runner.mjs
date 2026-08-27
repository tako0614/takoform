#!/usr/bin/env node

// This entry is never an operator-facing launcher. The static broker validates
// its exact bytes, starts it with an empty environment, and supplies a
// broker-attested run request and one credential envelope on inherited FDs 3/4.

import process from "node:process";

import {
  abandonBrokeredDeploy,
  consumeBrokeredDeployFromFds,
} from "./sealed-deploy-bootstrap.mjs";

if (import.meta.main) {
  try {
    if (
      process.execArgv.length !== 0 ||
      Object.keys(process.env).length !== 0 ||
      process.argv.length !== 6 ||
      process.argv[2] !== "--broker-run-request-fd" ||
      process.argv[3] !== "3" ||
      process.argv[4] !== "--broker-credential-fd" ||
      process.argv[5] !== "4"
    ) {
      throw new Error("sealed deploy runner accepts only exact broker FD invocation under an empty environment");
    }
    const attestation = consumeBrokeredDeployFromFds({
      requestFd: 3,
      credentialFd: 4,
    });
    try {
      const { runBrokeredDeploy } = await import("./deploy.mjs");
      await runBrokeredDeploy({ attestation });
    } catch (error) {
      abandonBrokeredDeploy(attestation);
      throw error;
    }
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      status: "blocked",
      phase: "broker-continuation",
      stage: "brokered-runner-bootstrap",
      externalStateTouched: false,
      externalStateIndeterminate: false,
      automaticCleanupAttempted: false,
      blindRetryAllowed: false,
      message: error.message,
    })}\n`);
    process.exitCode = 1;
  }
}
