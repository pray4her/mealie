export type Id = string;
export type TokenPair = { token: string; tokenExpired: number };
export type Identity = { uid: Id; refreshedToken?: TokenPair };
export interface AccountApi {
  signInWeixin(): Promise<Identity>;
  session(): Promise<Identity>;
  signOut(): Promise<void>;
}
export interface AppClient { account: AccountApi }
export type CloudSuccess<T> = { errCode: 0; data: T; newToken?: TokenPair };
export type ClientInfo = { appId: string; uniPlatform: string; deviceId?: string; clientIP?: string; locale?: string };
export type VerifiedToken = { uid: Id; issuedAtSeconds: number; expiresAtSeconds: number };
export interface TokenPort {
  verify(token: string, clientInfo: ClientInfo): Promise<VerifiedToken>;
  refreshIfNeeded(token: string, clientInfo: ClientInfo): Promise<TokenPair | null>;
}
export interface AccountStatusPort {
  get(uid: Id): Promise<{ status: number | null; tokens: string[]; validTokenDateMs: number | null } | null>;
}
