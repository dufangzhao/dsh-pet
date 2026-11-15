// Host-private QQ source I/O. Callers still supply actual source tasks and permissions.
export { createAuthorizedOfficialIo, type OfficialIoTestHooks } from './qq-official-io.js';
export { createAuthorizedOneBotIo } from './qq-onebot-io.js';
export type { CapturedQqBinding } from './qq-native-types.js';
export { ownedQqSocket } from './qq-socket.js';
export { withQqOperationCheck } from './qq-operation.js';
export {
  qqSourceId,
  qqSourceProtocol,
  qqSourceTarget,
  qqSourceAccount,
} from '../qq-source-identity.js';
