import { hashPassword, verifyPassword } from "better-auth/crypto";

export const hashSecretValue = async (value: string): Promise<string> => hashPassword(value);

export const verifySecretValue = async (input: { hash: string; value: string }): Promise<boolean> =>
  verifyPassword({
    hash: input.hash,
    password: input.value,
  });
