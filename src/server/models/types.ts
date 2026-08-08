export type PublicModelConfiguration = {
  readonly status: "CONFIGURED";
  readonly id: string;
  readonly version: number;
  readonly providerDisplayName: string;
  readonly baseUrl: string;
  readonly modelName: string;
  readonly contextWindowTokens: number | null;
  readonly supportsImageInput: boolean;
  readonly supportsNativePdfInput: boolean;
  readonly hasApiKey: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

export type ResolvedModelConfiguration = PublicModelConfiguration & {
  readonly tenantId: string;
  readonly apiKey: string | null;
};
