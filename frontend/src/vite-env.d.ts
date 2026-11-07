/// <reference types="vite/client" />

export interface ULevelPConfig {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  apiBaseUrl?: string;
  googleClientId?: string;
  notionTemplateUrl?: string;
}

declare global {
  interface Window {
    ULEVELP_CONFIG?: ULevelPConfig;
    supabase?: {
      createClient: (
        url: string,
        key: string,
        opts: {
          auth: {
            storageKey: string;
            flowType: 'pkce';
            persistSession: boolean;
            autoRefreshToken: boolean;
            detectSessionInUrl: boolean;
          };
        }
      ) => SupabaseClientLike;
    };
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (resp: { access_token?: string; expires_in?: string | number; error?: string; error_description?: string }) => void;
            error_callback?: (err: { message?: string; type?: string }) => void;
          }) => {
            requestAccessToken: (opts?: { prompt?: string }) => void;
          };
        };
      };
    };
    UL?: unknown;
    ULAuth?: unknown;
    ULData?: unknown;
    ULDrive?: unknown;
  }
}

export interface SupabaseUserLike {
  id: string;
  email?: string;
  user_metadata?: {
    full_name?: string;
    name?: string;
  };
}

export interface SupabaseSessionLike {
  access_token: string;
  user: SupabaseUserLike;
}

export interface SupabaseClientLike {
  auth: {
    getSession: () => Promise<{ data?: { session: SupabaseSessionLike | null } }>;
    onAuthStateChange: (
      cb: (event: string, session: SupabaseSessionLike | null) => void
    ) => { data?: { subscription?: { unsubscribe: () => void } } };
    signInWithOAuth: (params: {
      provider: 'google';
      options: { redirectTo: string };
    }) => Promise<{ data?: unknown; error?: Error | null }>;
    signOut: (opts: { scope: 'local' }) => Promise<{ error?: Error | null }>;
  };
}

