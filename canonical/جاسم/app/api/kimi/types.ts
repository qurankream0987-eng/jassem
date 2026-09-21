export type TokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
};

export type SessionPayload = {
  unionId: string;
  clientId: string;
  /**
   * When the token was minted.
   *
   * Carried out of the JWT because revocation needs it: the token has no id of
   * its own, so the only handle a revocation has is the moment it was issued.
   */
  issuedAt?: number;
};

export type UserProfile = {
  user_id: string;
  name: string;
  avatar_url: string;
};
