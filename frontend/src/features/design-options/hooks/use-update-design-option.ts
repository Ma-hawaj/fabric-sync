import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import type { DesignOption } from '../types/design-option'

// PATCH accepts any subset of the fields, so this serves both the edit form
// (which sends all of them) and the list page's activate/deactivate action
// (which sends only `isActive`). `imageDataUrl` is three-state: omitted leaves
// the illustration, `null` clears it, a data URL replaces it. There is
// deliberately no `slug`/`category` — those are the stored identity and can't
// change after creation.
export interface UpdateDesignOptionInput {
  id: string
  label?: string
  sortOrder?: number
  isActive?: boolean
  imageDataUrl?: string | null
}

async function updateDesignOption({
  id,
  ...changes
}: UpdateDesignOptionInput): Promise<DesignOption> {
  const { data } = await apiClient.patch<DesignOption>(
    `/design-options/${id}`,
    changes,
  )
  return data
}

export function useUpdateDesignOption() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: updateDesignOption,
    onSuccess: () => {
      // Retiring, renaming or re-illustrating an option rewrites every picker
      // that lists its category, so refetch the catalog rather than patching.
      void queryClient.invalidateQueries({ queryKey: ['design-options'] })
    },
  })
}
