import {setGlobalOptions} from "firebase-functions";

setGlobalOptions({maxInstances: 10, region: "africa-south1"});

export {
  createTenant,
  createBranch,
  inviteMember,
  inviteAnonymousManager,
  acceptAnonymousInvitation,
  acceptInvitation,
  setBranchAccess,
  deactivateMember,
  listAccessibleBranches,
  assertBranchAccess,
  getBranchPermissions,
} from "./tenants";

export {migrationImport, migrationFinalize} from "./migration";

export {syncOperations, pullChanges} from "./sync";
