import type { Id } from './identity';
import type { MembershipMutation } from './family';
import type { Page } from './recipes';

export type ShoppingItemFields = { raw: string; name: string | null; quantity: number | null; unit: string | null; note: string | null };
export type ShoppingList = { id: Id; familyId: Id; name: string; version: number; createdBy: Id | null; createdAt: number; updatedAt: number };
export type ShoppingItem = ShoppingItemFields & Omit<ShoppingList, 'name'> & { listId: Id; checked: boolean };
export type ShoppingAck = { id: Id };
export type ShoppingPageInput = { cursor?: string; limit?: number };
export type ShoppingItemKey = { listId: Id; id: Id };
export type ShoppingListCreate = MembershipMutation & { name: string };
export type ShoppingListChange = MembershipMutation & { id: Id; version: number };
export type ShoppingListRename = ShoppingListChange & { name: string };
export type ShoppingItemAdd = MembershipMutation & { listId: Id; item: ShoppingItemFields };
export type ShoppingItemChange = MembershipMutation & ShoppingItemKey & { version: number };
export type ShoppingItemUpdate = ShoppingItemChange & { item: ShoppingItemFields };
export type ShoppingCheck = ShoppingItemChange & { checked: boolean };
export type ShoppingIntent =
  | { kind: 'createList'; input: ShoppingListCreate }
  | { kind: 'renameList'; input: ShoppingListRename }
  | { kind: 'removeList'; input: ShoppingListChange }
  | { kind: 'addItem'; input: ShoppingItemAdd }
  | { kind: 'updateItem'; input: ShoppingItemUpdate }
  | { kind: 'removeItem'; input: ShoppingItemChange }
  | { kind: 'setChecked'; input: ShoppingCheck };
export interface ShoppingApi {
  listLists(input: ShoppingPageInput): Promise<Page<ShoppingList>>;
  getList(id: Id): Promise<ShoppingList>;
  createList(input: ShoppingListCreate): Promise<ShoppingAck>;
  renameList(input: ShoppingListRename): Promise<ShoppingAck>;
  removeList(input: ShoppingListChange): Promise<ShoppingAck>;
  listItems(input: ShoppingPageInput & { listId: Id }): Promise<Page<ShoppingItem>>;
  getItem(input: ShoppingItemKey): Promise<ShoppingItem>;
  addItem(input: ShoppingItemAdd): Promise<ShoppingAck>;
  updateItem(input: ShoppingItemUpdate): Promise<ShoppingAck>;
  removeItem(input: ShoppingItemChange): Promise<ShoppingAck>;
  setChecked(input: ShoppingCheck): Promise<ShoppingAck>;
}
