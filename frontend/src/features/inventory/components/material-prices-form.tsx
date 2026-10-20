import { useForm } from '@tanstack/react-form'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { toast } from 'sonner'
import { NumberField } from '@/components/form/fields'
import { Button } from '@/components/ui/button'
import { apiClient } from '@/lib/api'
import { CURRENCY } from '@/lib/currency'
import { moneyInputSchema } from '@/lib/money'
import {
  JUNIOR_BELOW_METRES,
  LARGE_ABOVE_METRES,
} from '@/features/invoices/lib/garment-pricing'
import type { Material } from '../types/inventory'

const schema = z.object({
  juniorPrice: moneyInputSchema,
  normalPrice: moneyInputSchema,
  largePrice: moneyInputSchema,
})

export function MaterialPricesForm({ material }: { material: Material }) {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: async (prices: {
      juniorPrice: number | ''
      normalPrice: number | ''
      largePrice: number | ''
    }) =>
      (await apiClient.patch<Material>(`/materials/${material.id}`, prices))
        .data,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['materials'] })
      void queryClient.invalidateQueries({
        queryKey: ['invoice-order-material'],
      })
    },
  })
  const form = useForm({
    defaultValues: {
      juniorPrice: material.juniorPrice ?? ('' as const),
      normalPrice: material.normalPrice ?? ('' as const),
      largePrice: material.largePrice ?? ('' as const),
    },
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => {
      const pending = mutation.mutateAsync(value)
      toast.promise(pending, {
        loading: 'Saving prices...',
        success: 'Material prices saved.',
        error: 'Could not save material prices.',
      })
      try {
        await pending
      } catch {
        return
      }
    },
  })
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault()
        event.stopPropagation()
        void form.handleSubmit()
      }}
    >
      <h3 className="font-semibold">Garment prices incl. VAT ({CURRENCY})</h3>
      <p className="text-xs text-muted-foreground">
        Junior below {JUNIOR_BELOW_METRES} m; normal {JUNIOR_BELOW_METRES}–
        {LARGE_ABOVE_METRES} m inclusive; large above {LARGE_ABOVE_METRES} m.
        Design costs are added separately.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <NumberField form={form} name="juniorPrice" label="Junior price" />
        <NumberField form={form} name="normalPrice" label="Normal price" />
        <NumberField form={form} name="largePrice" label="Large price" />
      </div>
      <Button type="submit" disabled={mutation.isPending}>
        Save prices
      </Button>
    </form>
  )
}
