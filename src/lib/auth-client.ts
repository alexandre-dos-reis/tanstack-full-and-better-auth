import {
  prefetchSession as ba_prefetchSession,
  ensureSession as ba_ensureSession,
  type RequestPasswordResetOptions,
  type ResetPasswordOptions,
  type SendVerificationEmailOptions,
  type SignInEmailOptions,
  type SignInSocialOptions,
  type SignOutOptions,
  type SignUpEmailOptions,
} from "@better-auth-ui/core";
import type { UseSessionOptions } from "@better-auth-ui/react";
import {
  useSignOut as ba_useSignOut,
  useSignInEmail as ba_useSignInEmail,
  useSignUpEmail as ba_useSignUpEmail,
  useUser as ba_useUser,
  useSignInSocial as ba_useSignInSocial,
  useRequestPasswordReset as ba_useRequestPasswordReset,
  useResetPassword as ba_useResetPassword,
  useSendVerificationEmail as ba_useSendVerificationEmail,
  useUpdateUser as ba_useUpdateUser,
  useChangeEmail as ba_useChangeEmail,
  useChangePassword as ba_useChangePassword,
} from "@better-auth-ui/react";
import type { QueryClient } from "@tanstack/react-query";
import { createAuthClient } from "better-auth/react";

export namespace AuthClient {
  export const client = createAuthClient({
    basePath: "/api/auth",
  });

  type AuthClient = typeof client;

  export const prefetchSession = (queryClient: QueryClient) =>
    ba_prefetchSession(queryClient, client);

  export const ensureSession = (queryClient: QueryClient) => ba_ensureSession(queryClient, client);

  export const useSignOut = (opt: SignOutOptions<AuthClient>) => ba_useSignOut(client, opt);

  export const useSignInEmail = (opt: SignInEmailOptions<AuthClient>) =>
    ba_useSignInEmail(client, opt);

  export const useSignUpEmail = (opt: SignUpEmailOptions<AuthClient>) =>
    ba_useSignUpEmail(client, opt);

  export const useUser = (opt?: UseSessionOptions<AuthClient>) => ba_useUser(client, opt);

  export const useSignInSocial = (opt: SignInSocialOptions<AuthClient>) =>
    ba_useSignInSocial(client, opt);

  export const useRequestPasswordReset = (opt: RequestPasswordResetOptions<AuthClient>) =>
    ba_useRequestPasswordReset(client, opt);

  export const useResetPassword = (opt: ResetPasswordOptions<AuthClient>) =>
    ba_useResetPassword(client, opt);

  export const useSendVerificationEmail = (opt: SendVerificationEmailOptions<AuthClient>) =>
    ba_useSendVerificationEmail(client, opt);

  export const useUpdateUser = () => ba_useUpdateUser(client);

  export const useChangeEmail = () => ba_useChangeEmail(client);

  export const useChangePassword = () => ba_useChangePassword(client);
}
