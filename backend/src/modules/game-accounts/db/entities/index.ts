import { CredentialAccess } from './credential-access.entity';
import { BuyerKey } from './buyer-key.entity';
import { PlayerIdClaim } from './player-id-claim.entity';
import { TakeoverConfirmation } from './takeover-confirmation.entity';
import { GameAccountDetail } from './game-account-detail.entity';
import { Game } from './game.entity';
import { CredentialHandover } from './credential-handover.entity';
import { GameAccountsOutboxEvent } from './game-accounts-outbox-event.entity';
import { OwnershipProof } from './ownership-proof.entity';
import { SealedCredential } from './sealed-credential.entity';

export { CredentialAccess } from './credential-access.entity';
export { BuyerKey } from './buyer-key.entity';
export { PlayerIdClaim } from './player-id-claim.entity';
export { TakeoverConfirmation } from './takeover-confirmation.entity';
export { GameAccountDetail } from './game-account-detail.entity';
export { Game } from './game.entity';
export { CredentialHandover } from './credential-handover.entity';
export { GameAccountsOutboxEvent } from './game-accounts-outbox-event.entity';
export { OwnershipProof } from './ownership-proof.entity';
export { SealedCredential } from './sealed-credential.entity';

// Every table of the schemas game_accounts, for TypeOrmModule.forFeature.
export const ENTITIES = [
  CredentialAccess,
  BuyerKey,
  PlayerIdClaim,
  TakeoverConfirmation,
  GameAccountDetail,
  Game,
  CredentialHandover,
  GameAccountsOutboxEvent,
  OwnershipProof,
  SealedCredential,
];
