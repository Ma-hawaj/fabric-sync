import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import type { DesignOption } from '../types/design-option'
import type { DesignOptionFormValues } from '../types/design-option-form'

async function createDesignOption(
  values: DesignOptionFormValues,
): Promise<DesignOption> {
  const { data } = await apiClient.post<DesignOption>('/design-options', {
    category: values.category,
    slug: values.slug,
    label: values.label,
    cost: values.cost,
    sortOrder: values.sortOrder === '' ? undefined : Number(values.sortOrder),
    imageDataUrl: values.imageDataUrl ?? undefined,
  })
  return data
}

export function useCreateDesignOption() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: createDesignOption,
    onSuccess: () => {
      // A new option can land in any picker's list, so refetch the catalog
      // rather than patching one category's worth of rows.
      void queryClient.invalidateQueries({ queryKey: ['design-options'] })
    },
  })
}
