export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  // GHL Marketplace OAuth
  ghlClientId: process.env.GHL_CLIENT_ID ?? "",
  ghlClientSecret: process.env.GHL_CLIENT_SECRET ?? "",
  ghlInitialDelayFieldId: process.env.GHL_INITIAL_DELAY_FIELD_ID ?? "",
  ghlFollowUpLimitFieldId: process.env.GHL_FOLLOW_UP_LIMIT_FIELD_ID ?? "",
};
