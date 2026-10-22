import { useState } from 'react'
import { useForm } from '@tanstack/react-form'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { NumberField, TextField } from '@/components/form/fields'
import { SegmentedOptions } from '@/components/form/segmented-options'
import { apiBaseUrl, ApiError } from '@/lib/api'
import { useCreateDesignOption } from './hooks/use-create-design-option'
import { useDesignOptions } from './hooks/use-design-options'
import { useUpdateDesignOption } from './hooks/use-update-design-option'
import {
  DESIGN_CATEGORIES,
  designCategoryLabel,
} from './lib/design-option-categories'
import { designOptionFormSchema } from './lib/design-option-schema'
import {
  createEmptyDesignOptionForm,
  designOptionToFormValues,
} from './types/design-option-form'
import type { DesignOption } from './types/design-option'

// Matches the server's 2 MiB raw-byte cap — the design-options route accepts a
// larger JSON envelope because base64 adds roughly one third to this size.
const MAX_IMAGE_BYTES = 2 * 1024 * 1024

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('could not read that file'))
    reader.readAsDataURL(file)
  })
}

export function DesignOptionFormPage({ optionId }: { optionId?: string }) {
  const { data: options = [], isLoading } = useDesignOptions()
  const existing = optionId
    ? options.find((option) => option.id === optionId)
    : undefined

  if (optionId && isLoading) {
    return (
      <div className="text-center text-sm text-muted-foreground py-10">
        Loading option...
      </div>
    )
  }

  if (optionId && !existing) {
    return (
      <div className="text-center text-sm text-muted-foreground py-10">
        That option could not be found.
      </div>
    )
  }

  // Keyed so the form re-initialises if the underlying option changes —
  // defaultValues is only read on the first render.
  return <DesignOptionForm key={existing?.id ?? 'new'} existing={existing} />
}

function DesignOptionForm({ existing }: { existing?: DesignOption }) {
  const navigate = useNavigate()
  const createOption = useCreateDesignOption()
  const updateOption = useUpdateDesignOption()
  const mutation = existing ? updateOption : createOption
  // Clearing the stored illustration is separate from picking a new file: the
  // form field only ever carries a fresh upload, so "remove" needs its own
  // flag to tell "untouched" apart from "cleared" on submit.
  const [clearImage, setClearImage] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)

  const form = useForm({
    defaultValues: existing
      ? designOptionToFormValues(existing, null)
      : createEmptyDesignOptionForm(),
    validators: { onSubmit: designOptionFormSchema },
    onSubmit: async ({ value }) => {
      const pending = existing
        ? updateOption.mutateAsync({
            id: existing.id,
            label: value.label,
            sortOrder: Number(value.sortOrder),
            isActive: value.isActive,
            ...(value.imageDataUrl !== null
              ? { imageDataUrl: value.imageDataUrl }
              : clearImage
                ? { imageDataUrl: null }
                : {}),
          })
        : createOption.mutateAsync(value)

      toast.promise(pending, {
        loading: existing ? 'Saving option...' : 'Adding option...',
        success: (option) =>
          existing
            ? `${option.label} was updated.`
            : `${option.label} was added.`,
        error: (error) =>
          error instanceof ApiError && error.status === 409
            ? 'An option with this id already exists in this category.'
            : 'Could not save this option. Please try again.',
      })

      try {
        await pending
      } catch {
        return
      }
      await navigate({ to: '/design-options' })
    },
  })

  const categoryLabels = DESIGN_CATEGORIES.map((meta) => meta.label)
  const storedImageUrl = existing?.hasImage
    ? `${apiBaseUrl}${existing.imageUrl}`
    : null

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          {existing ? 'Edit Option' : 'Add Option'}
        </h1>
        <p className="text-muted-foreground">
          Options are shared by every order form. Changing this list takes
          effect on work already in progress.
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          e.stopPropagation()
          void form.handleSubmit()
        }}
        className="max-w-xl space-y-6"
      >
        <div className="space-y-4 rounded-xl border border-border/60 bg-card p-5">
          <form.Field name="category">
            {(field) =>
              existing ? (
                <Field>
                  <FieldLabel>Category</FieldLabel>
                  <p className="text-sm font-medium">
                    {designCategoryLabel(field.state.value)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    The slot an option belongs to can&apos;t change — orders
                    store the category alongside the id.
                  </p>
                </Field>
              ) : (
                <Field>
                  <FieldLabel htmlFor={field.name}>Category</FieldLabel>
                  <SegmentedOptions
                    id={field.name}
                    options={categoryLabels}
                    value={designCategoryLabel(field.state.value)}
                    onChange={(label) => {
                      const meta = DESIGN_CATEGORIES.find(
                        (entry) => entry.label === label,
                      )
                      if (meta) field.handleChange(meta.key)
                    }}
                    columns={3}
                  />
                </Field>
              )
            }
          </form.Field>

          {existing ? (
            <Field>
              <FieldLabel>Id</FieldLabel>
              <p className="font-mono text-sm font-medium">{existing.slug}</p>
              <p className="text-xs text-muted-foreground">
                The id is what orders store, so it can&apos;t change after
                creation. Change the label instead.
              </p>
            </Field>
          ) : (
            <TextField form={form} name="slug" label="Id" />
          )}

          <TextField form={form} name="label" label="Display Label" />
          <NumberField form={form} name="sortOrder" label="Position" />

          <form.Field name="imageDataUrl">
            {(field) => {
              const preview = field.state.value ?? null
              return (
                <Field>
                  <FieldLabel htmlFor={field.name}>Illustration</FieldLabel>
                  {preview ? (
                    <img
                      src={preview}
                      alt=""
                      draggable={false}
                      className="h-24 w-full rounded-md border border-border/60 bg-background object-contain"
                    />
                  ) : storedImageUrl && !clearImage ? (
                    <img
                      src={storedImageUrl}
                      alt=""
                      draggable={false}
                      className="h-24 w-full rounded-md border border-border/60 bg-background object-contain"
                    />
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      No illustration — the option shows as text until one is
                      uploaded.
                    </p>
                  )}
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        document.getElementById('design-option-image')?.click()
                      }
                    >
                      {preview || (storedImageUrl && !clearImage)
                        ? 'Replace image'
                        : 'Upload image'}
                    </Button>
                    {(preview || (storedImageUrl && !clearImage)) && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          field.handleChange(null)
                          setClearImage(true)
                          setFileError(null)
                        }}
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                  <input
                    id="design-option-image"
                    type="file"
                    accept="image/svg+xml,image/webp,image/png,image/jpeg"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0]
                      event.target.value = ''
                      if (!file) return
                      if (file.size > MAX_IMAGE_BYTES) {
                        setFileError(
                          'That image is over 2 MB. Pick a smaller one.',
                        )
                        return
                      }
                      setFileError(null)
                      void readFileAsDataUrl(file).then(
                        (dataUrl) => {
                          field.handleChange(dataUrl)
                          setClearImage(false)
                        },
                        () => {
                          setFileError(
                            'Could not read that file. Please try another.',
                          )
                        },
                      )
                    }}
                  />
                  {fileError ? (
                    <p className="text-xs font-medium text-destructive">
                      {fileError}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      SVG, WebP, PNG or JPEG, up to 2 MB. The same picture
                      prints on the invoice.
                    </p>
                  )}
                </Field>
              )
            }}
          </form.Field>

          {existing && (
            <form.Field name="isActive">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor={field.name}>Status</FieldLabel>
                  <SegmentedOptions
                    id={field.name}
                    options={['Active', 'Retired']}
                    value={field.state.value ? 'Active' : 'Retired'}
                    onChange={(label) => field.handleChange(label === 'Active')}
                    columns={2}
                  />
                  <p className="text-xs text-muted-foreground">
                    Retired options drop out of the picker, except on orders
                    that already used them.
                  </p>
                </Field>
              )}
            </form.Field>
          )}
        </div>

        <form.Subscribe
          selector={(state) =>
            [state.submissionAttempts, state.isValid] as const
          }
        >
          {([submissionAttempts, isValid]) =>
            submissionAttempts > 0 &&
            !isValid && (
              <p className="text-sm font-medium text-destructive">
                Please fix the highlighted fields before saving.
              </p>
            )
          }
        </form.Subscribe>

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate({ to: '/design-options' })}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            Save
          </Button>
        </div>
      </form>
    </div>
  )
}
