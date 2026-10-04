export type GuestEmailStatus = "checking" | "available" | "unavailable" | "unknown";

// An already-issued code can still be verified. Existing signed-in guests do not need a new code.
export function guestSignupCanProceed(status: GuestEmailStatus, codeReady: boolean, signedIn = false): boolean {
  return signedIn || codeReady || status === "available";
}

export function guestEmailStatusMessage(status: GuestEmailStatus): string {
  if (status === "checking") return "Checking email sign-up availability…";
  if (status === "unavailable") return "New My Stay registration is temporarily unavailable because the house's email service is not connected. You can still browse stays, or contact the house to enquire.";
  if (status === "unknown") return "We could not check email sign-up availability. Check again, or contact the house to enquire.";
  return "";
}
