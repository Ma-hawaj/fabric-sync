import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api'
import { Checkbox } from '@/components/ui/checkbox'
import type { Customer } from '@/features/customers/types/customers'

export function CustomerNotificationPreference({
  customer,
}: {
  customer: Customer
}) {
  const client = useQueryClient()
  const mutation = useMutation({
    mutationFn: async (enabled: boolean) =>
      (
        await apiClient.patch<Customer>(`/customers/${customer.id}/whatsapp`, {
          enabled,
        })
      ).data,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['customers'] })
      toast.success('WhatsApp update preference saved.')
    },
    onError: (error) => toast.error(error.message),
  })
  return (
    <label className="flex items-start gap-2 text-sm">
      <Checkbox
        className="mt-0.5"
        checked={customer.whatsappNotificationsEnabled ?? true}
        disabled={mutation.isPending}
        onCheckedChange={(checked) => mutation.mutate(checked)}
      />
      Receive invoice and pickup updates via WhatsApp
    </label>
  )
}
