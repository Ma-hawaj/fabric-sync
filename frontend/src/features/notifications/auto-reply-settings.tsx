import { useState } from 'react'
import { useForm } from '@tanstack/react-form'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { NumberField, TextareaField, TextField } from '@/components/form/fields'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useAutoReply, useUpdateAutoReply } from './hooks/use-auto-reply'
import { autoReplySchema } from './lib/auto-reply-schema'
import type {
  AutoReplySettings,
  AutoReplyUpdate,
} from './lib/auto-reply-schema'

export function AutoReplySettingsButton() {
  const [open, setOpen] = useState(false)
  const query = useAutoReply(open)
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Automatic reply
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>WhatsApp automatic reply</DialogTitle>
            <DialogDescription>
              Direct customers who reply to the notification number to your
              shop’s main contact number.
            </DialogDescription>
          </DialogHeader>
          {(query.isPending || query.isFetching) && <p>Loading settings…</p>}
          {query.isError && (
            <div role="alert" className="space-y-2">
              <p>Automatic reply settings could not be loaded.</p>
              <Button variant="outline" onClick={() => void query.refetch()}>
                Try again
              </Button>
            </div>
          )}
          {query.data && !query.isFetching && !query.isError && (
            <AutoReplyForm
              settings={query.data}
              onClose={() => setOpen(false)}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

function AutoReplyForm({
  settings,
  onClose,
}: {
  settings: AutoReplySettings
  onClose: () => void
}) {
  const mutation = useUpdateAutoReply()
  const [problem, setProblem] = useState('')
  const { enabled, message, cooldownHours, maxPerMinute } = settings
  const button = settings.button ?? null
  async function save(value: AutoReplyUpdate) {
    setProblem('')
    try {
      await mutation.mutateAsync(value)
      toast.success(
        value.enabled
          ? 'Automatic reply settings saved.'
          : 'Automatic replies turned off.',
      )
      onClose()
    } catch {
      setProblem('Could not save automatic reply settings. Please try again.')
    }
  }
  const form = useForm({
    defaultValues: { enabled, message, cooldownHours, maxPerMinute, button },
    validators: { onSubmit: autoReplySchema },
    onSubmit: async ({ value }) => save(value),
  })
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
    >
      <p role="status" className="text-sm font-medium">
        Automatic replies are currently {settings.enabled ? 'on' : 'off'}.
      </p>
      {!settings.deliveryConfigured && (
        <p className="text-sm text-muted-foreground">
          Configure and enable WhatsApp delivery before turning on automatic
          replies. You can save the reply text while delivery is unavailable.
        </p>
      )}
      <fieldset disabled={mutation.isPending} className="space-y-4">
        <form.Field name="enabled">
          {(field) => (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={field.state.value}
                onCheckedChange={field.handleChange}
                disabled={!settings.deliveryConfigured && !settings.enabled}
              />
              Enable automatic replies
            </label>
          )}
        </form.Field>
        <TextareaField form={form} name="message" label="Reply message" />
        <p className="text-xs text-muted-foreground">
          Include your main WhatsApp number or contact link. The same text is
          sent to each customer who messages this number.
        </p>
        <form.Subscribe selector={(state) => state.values.button}>
          {(currentButton) =>
            currentButton ? (
              <div className="space-y-3 rounded-lg border p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">Reply button</p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => form.setFieldValue('button', null)}
                  >
                    Remove button
                  </Button>
                </div>
                <TextField
                  form={form}
                  name="button.label"
                  label="Button label"
                />
                <TextField
                  form={form}
                  name="button.url"
                  label="Button destination URL"
                />
                <p className="text-xs text-muted-foreground">
                  Use a website link or a WhatsApp link such as
                  https://wa.me/97333112233. WhatsApp supports one link button
                  per automatic reply, a label of up to 20 characters, and reply
                  text of up to 1,024 characters with a button.
                </p>
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  form.setFieldValue('button', { label: 'Contact us', url: '' })
                }
              >
                Add button
              </Button>
            )
          }
        </form.Subscribe>
        <div className="grid gap-4 sm:grid-cols-2">
          <NumberField
            form={form}
            name="cooldownHours"
            label="Hours between replies per customer"
            min={1}
            max={168}
            step={1}
          />
          <NumberField
            form={form}
            name="maxPerMinute"
            label="Maximum replies per minute"
            min={1}
            max={60}
            step={1}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Repeated messages within the cooldown receive no additional reply.
          Turning this off cancels waiting replies; a reply already sending may
          still arrive.
        </p>
      </fieldset>
      {problem && (
        <p role="alert" className="text-sm text-destructive">
          {problem}
        </p>
      )}
      <DialogFooter className="flex-wrap">
        {settings.enabled && (
          <Button
            type="button"
            variant="destructive"
            disabled={mutation.isPending}
            onClick={() =>
              void save({
                enabled: false,
                message,
                cooldownHours,
                maxPerMinute,
                button,
              })
            }
          >
            Turn off now
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          onClick={onClose}
          disabled={mutation.isPending}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? 'Saving…' : 'Save settings'}
        </Button>
      </DialogFooter>
    </form>
  )
}
