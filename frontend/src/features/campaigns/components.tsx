import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useQuery } from '@tanstack/react-query'
import { apiClient, ApiError } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldLabel, FieldError } from '@/components/ui/field'
import type { AnyFormApi } from '@/components/form/fields'
import { useCampaignMutation } from './hooks'

export function errorMessage(error: unknown): string {
  return error instanceof ApiError || error instanceof Error
    ? error.message
    : 'The request failed. Please try again.'
}
export function SimpleField({
  form,
  name,
  label,
  type = 'text',
  options,
}: {
  form: AnyFormApi
  name: string
  label: string
  type?: string
  options?: { value: string; label: string }[]
}) {
  return (
    <form.Field name={name}>
      {(field: any) => (
        <Field>
          <FieldLabel htmlFor={name}>{label}</FieldLabel>
          {options ? (
            <select
              id={name}
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
            >
              {options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          ) : type === 'checkbox' ? (
            <input
              id={name}
              type="checkbox"
              checked={Boolean(field.state.value)}
              onChange={(event) => field.handleChange(event.target.checked)}
            />
          ) : (
            <Input
              id={name}
              type={type}
              step={type === 'datetime-local' ? 1 : undefined}
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
            />
          )}
          <FieldError errors={field.state.meta.errors} />
        </Field>
      )}
    </form.Field>
  )
}
export function AssetUpload({
  value,
  onChange,
}: {
  value: string | null
  onChange: (id: string | null) => void
}) {
  const mutation = useCampaignMutation<{ id: string }>()
  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium">
        Promotional image (PNG or JPEG, up to 5 MB)
        <Input
          type="file"
          accept="image/png,image/jpeg"
          disabled={mutation.isPending}
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (!file) return
            if (file.size > 5 * 1024 * 1024) {
              toast.error('Choose an image of at most 5 MB.')
              return
            }
            const reader = new FileReader()
            reader.onerror = () => toast.error('Could not read this image.')
            reader.onload = () => {
              const pending = mutation.mutateAsync({
                path: '/campaign-assets',
                body: {
                  filename: file.name,
                  mimeType: file.type,
                  dataBase64: String(reader.result).split(',')[1],
                },
              })
              toast.promise(pending, {
                loading: 'Uploading image...',
                success: 'Image uploaded.',
                error: errorMessage,
              })
              void pending
                .then((asset) => onChange(asset.id))
                .catch(() => undefined)
            }
            reader.readAsDataURL(file)
          }}
        />
      </label>
      {value && (
        <>
          <AssetImage id={value} />
          <Button
            type="button"
            variant="outline"
            onClick={() => onChange(null)}
          >
            Remove image
          </Button>
        </>
      )}
    </div>
  )
}
export function AssetImage({ id }: { id: string }) {
  const { data } = useQuery({
    queryKey: ['campaign-image', id],
    queryFn: async () =>
      (
        await apiClient.get<Blob>(`/campaign-assets/${id}`, {
          responseType: 'blob',
        })
      ).data,
    staleTime: 5 * 60 * 1000,
  })
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    if (!data) return
    const objectUrl = URL.createObjectURL(data)
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [data])
  return url ? (
    <img
      src={url}
      alt="Promotional image"
      className="max-h-72 rounded-lg object-contain"
    />
  ) : (
    <p className="text-sm text-muted-foreground">Loading image...</p>
  )
}
export function StateBadge({ state }: { state: string }) {
  return (
    <span className="inline-flex rounded-full border px-2 py-0.5 text-xs capitalize">
      {state.replaceAll('_', ' ')}
    </span>
  )
}
