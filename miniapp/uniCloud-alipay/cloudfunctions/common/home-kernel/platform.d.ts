export interface CloudPlatform {
  database(): {
    collection(name: string): {
      doc(uid: string): {
        field(projection: Record<string, boolean>): {
          get(): Promise<{ data: { status?: number; token?: string[]; valid_token_date?: number }[] }>;
        };
      };
    };
  };
}
