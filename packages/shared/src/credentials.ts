import { z } from 'zod';

// The rules for passwords and PINs. The API enforces them and the web forms check them first,
// so both use this one file. A problem is a code, which the web app turns into a sentence in
// the current language.
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

export type PinProblem = 'PIN_FORMAT' | 'PIN_REPEATED' | 'PIN_SEQUENCE';
export type PasswordProblem = 'PASSWORD_TOO_SHORT' | 'PASSWORD_TOO_LONG';

// A PIN is 4 to 6 digits and not too easy to guess: not one digit repeated (1111) and not a
// straight run up or down (1234, 4321).
export function pinProblem(pin: string): PinProblem | null {
  if (!/^\d{4,6}$/.test(pin)) return 'PIN_FORMAT';

  const digits = [...pin].map(Number);
  if (digits.every((digit) => digit === digits[0])) return 'PIN_REPEATED';

  const steps = digits.slice(1).map((digit, index) => digit - (digits[index] ?? 0));
  if (steps.every((step) => step === 1) || steps.every((step) => step === -1)) {
    return 'PIN_SEQUENCE';
  }
  return null;
}

// Length counts characters, not bytes, so Arabic and English passwords are treated alike.
export function passwordProblem(password: string): PasswordProblem | null {
  const length = [...password].length;
  if (length < PASSWORD_MIN_LENGTH) return 'PASSWORD_TOO_SHORT';
  if (length > PASSWORD_MAX_LENGTH) return 'PASSWORD_TOO_LONG';
  return null;
}

export const pinSchema = z.string().superRefine((pin, ctx) => {
  const problem = pinProblem(pin);
  if (problem) ctx.addIssue({ code: 'custom', message: problem });
});

export const passwordSchema = z.string().superRefine((password, ctx) => {
  const problem = passwordProblem(password);
  if (problem) ctx.addIssue({ code: 'custom', message: problem });
});

export const credentialTypes = ['password', 'pin'] as const;
export const credentialTypeSchema = z.enum(credentialTypes);
export type CredentialType = z.infer<typeof credentialTypeSchema>;

// Set a new password or PIN. Without a value the server makes one and returns it once.
export const setCredentialsRequestSchema = z
  .strictObject({
    type: credentialTypeSchema,
    value: z.string().optional(),
  })
  .superRefine((request, ctx) => {
    if (request.value === undefined) return;

    const problem =
      request.type === 'pin' ? pinProblem(request.value) : passwordProblem(request.value);
    if (problem) ctx.addIssue({ code: 'custom', path: ['value'], message: problem });
  });

export type SetCredentialsRequest = z.infer<typeof setCredentialsRequestSchema>;

export const credentialsResultSchema = z.object({
  type: credentialTypeSchema,
  // Only set when the server made the value. It is shown once and never stored in readable form.
  generatedValue: z.string().nullable(),
});

export type CredentialsResult = z.infer<typeof credentialsResultSchema>;
