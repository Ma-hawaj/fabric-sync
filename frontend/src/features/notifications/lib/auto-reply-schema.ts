import { z } from 'zod'

function hasControlCharacters(value: string) {
  return [...value].some((character) => {
    const code = character.charCodeAt(0)
    return code < 32 || (code >= 127 && code <= 159)
  })
}

function validButtonUrl(value: string) {
  try {
    const url = new URL(value)
    return (
      /^https?:\/\//i.test(value) &&
      !!url.hostname &&
      !url.username &&
      !url.password &&
      !/\s/.test(value) &&
      !hasControlCharacters(value)
    )
  } catch {
    return false
  }
}

const linkButtonSchema = z.object({
  label: z
    .string()
    .trim()
    .min(1, 'Enter a button label.')
    .refine(
      (value) => [...value].length <= 20 && !hasControlCharacters(value),
      {
        message:
          'Use a button label of up to 20 characters, without control characters.',
      },
    ),
  url: z
    .string()
    .trim()
    .refine((value) => [...value].length <= 2048 && validButtonUrl(value), {
      message:
        'Enter a complete http:// or https:// URL without credentials or spaces, up to 2,048 characters.',
    }),
})

export const autoReplySchema = z
  .object({
    enabled: z.boolean(),
    button: linkButtonSchema.nullable(),
    message: z
      .string()
      .trim()
      .refine((value) => [...value].length <= 4096, {
        message: 'Keep the reply within 4,096 characters.',
      }),
    cooldownHours: z
      .number()
      .int('Enter a whole number of hours.')
      .min(1, 'Wait at least one hour between replies.')
      .max(168, 'Choose a cooldown of up to 168 hours.'),
    maxPerMinute: z
      .number()
      .int('Enter a whole number of replies.')
      .min(1, 'Allow at least one reply per minute.')
      .max(60, 'Allow up to 60 replies per minute.'),
  })
  .refine((value) => !value.enabled || value.message.trim().length > 0, {
    message: 'Enter a reply message before enabling automatic replies.',
    path: ['message'],
  })
  .refine(
    (value) => !value.button || [...value.message.trim()].length <= 1024,
    {
      message: 'Keep the reply within 1,024 characters when adding a button.',
      path: ['message'],
    },
  )

export type AutoReplyUpdate = z.infer<typeof autoReplySchema>
export type AutoReplySettings = AutoReplyUpdate & {
  deliveryConfigured: boolean
}
