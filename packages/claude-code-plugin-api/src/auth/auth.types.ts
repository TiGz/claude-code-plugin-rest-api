export interface AuthUser {
  username: string;
  [key: string]: unknown;
}

export interface AuthProvider {
  /**
   * Validate credentials and return user if valid
   * @returns AuthUser if valid, null if invalid
   */
  validate(username: string, password: string): Promise<AuthUser | null>;
}

export interface AuthModuleOptions {
  /**
   * Disable authentication entirely
   * @default false
   */
  disabled?: boolean;

  /**
   * Custom auth provider (overrides default YAML file provider)
   */
  provider?: AuthProvider;

  /**
   * Path to auth.yml file (only used with default provider)
   * @default 'auth.yml'
   */
  authFilePath?: string;

  /**
   * Paths to exclude from authentication (supports wildcards)
   * @default ['/health', '/api/docs*']
   */
  excludePaths?: string[];
}

export const AUTH_OPTIONS = 'AUTH_OPTIONS';
export const AUTH_PROVIDER = 'AUTH_PROVIDER';
