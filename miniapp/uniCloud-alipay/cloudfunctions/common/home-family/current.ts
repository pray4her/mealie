import type { FamilyView, Identity } from 'home-contracts';
import type { DatabasePort } from 'home-kernel';
import { readFamily } from './repository';

export function currentFamily(database: DatabasePort, identity: Identity): Promise<FamilyView | null> {
  return database.transaction(tx => readFamily(tx, identity.uid));
}
