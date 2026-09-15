import { describe, expect, it } from "vitest";
import {
  isVerifiedReceipt,
  summarizeLatestVerification,
} from "../../api/runtime/truthfulness";

describe("Smart UI Task 9B truthfulness gates", () => {
  it.each([
    [[], "PENDING"],
    [[["node-1", 1, "PENDING"]], "PENDING"],
    [[["node-1", 1, "VERIFIED"]], "VERIFIED"],
    [[["node-1", 1, "FAILED"]], "FAILED"],
    [[["node-1", 1, "INCONCLUSIVE"]], "INCONCLUSIVE"],
    [
      [["node-1", 1, "VERIFIED"], ["node-2", 1, "VERIFIED"]],
      "VERIFIED",
    ],
    [
      [["node-1", 1, "VERIFIED"], ["node-2", 1, "PENDING"]],
      "PENDING",
    ],
    [
      [["node-1", 1, "VERIFIED"], ["node-2", 1, "FAILED"]],
      "FAILED",
    ],
    [
      [["node-1", 1, "VERIFIED"], ["node-2", 1, "INCONCLUSIVE"]],
      "INCONCLUSIVE",
    ],
    [
      [["node-1", 1, "FAILED"], ["node-1", 2, "VERIFIED"]],
      "VERIFIED",
    ],
    [
      [["node-1", 2, "VERIFIED"], ["node-1", 1, "FAILED"]],
      "VERIFIED",
    ],
    [
      [["node-1", 3, "INCONCLUSIVE"], ["node-1", 2, "VERIFIED"]],
      "INCONCLUSIVE",
    ],
    [
      [["node-1", 2, "FAILED"], ["node-1", 1, "INCONCLUSIVE"]],
      "FAILED",
    ],
    [
      [["node-1", 3, "PENDING"], ["node-1", 2, "VERIFIED"]],
      "PENDING",
    ],
    [
      [["node-1", 3, "VERIFIED"], ["node-1", 2, "PENDING"]],
      "VERIFIED",
    ],
    [
      [["node-1", 1, "VERIFIED"], ["node-2", 1, "VERIFIED"], ["node-3", 1, "VERIFIED"]],
      "VERIFIED",
    ],
    [
      [["node-1", 1, "VERIFIED"], ["node-2", 1, "VERIFIED"], ["node-3", 1, "PENDING"]],
      "PENDING",
    ],
    [
      [["node-1", 1, "VERIFIED"], ["node-2", 1, "INCONCLUSIVE"], ["node-3", 1, "FAILED"]],
      "INCONCLUSIVE",
    ],
    [
      [["node-1", 4, "VERIFIED"], ["node-1", 2, "FAILED"], ["node-2", 1, "VERIFIED"]],
      "VERIFIED",
    ],
    [
      [["node-1", 4, "PENDING"], ["node-1", 2, "FAILED"], ["node-2", 1, "VERIFIED"]],
      "PENDING",
    ],
  ] as const)("summarizes verification truth case %#", (rawAttempts, expected) => {
    const attempts = rawAttempts.map(([nodeId, attemptNumber, verificationStatus]) => ({
      nodeId,
      attemptNumber,
      verificationStatus,
    }));
    expect(summarizeLatestVerification(attempts)).toBe(expected);
  });

  it.each([
    ["completed", 1, 1, "VERIFIED", true],
    ["completed", 2, 2, "VERIFIED", true],
    ["completed", 1, 1, "PENDING", false],
    ["completed", 1, 1, "INCONCLUSIVE", false],
    ["completed", 1, 1, "FAILED", false],
    ["completed", 0, 0, "VERIFIED", false],
    ["completed", 1, 2, "VERIFIED", false],
    ["failed", 1, 1, "VERIFIED", false],
    ["ready", 1, 1, "VERIFIED", false],
    ["completed", 0, 1, "VERIFIED", false],
    ["completed", 1, 0, "VERIFIED", false],
    ["completed", 3, 3, "VERIFIED", true],
    ["completed", 3, 3, "PENDING", false],
    ["COMPLETED", 1, 1, "VERIFIED", false],
  ] as const)(
    "only accepts independently verified complete receipt case %#",
    (runStatus, completedNodes, nodeCount, verificationStatus, expected) => {
      expect(
        isVerifiedReceipt(runStatus, completedNodes, nodeCount, verificationStatus),
      ).toBe(expected);
    },
  );
});