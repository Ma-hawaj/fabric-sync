import { apiClient } from '@/lib/api'

export async function downloadGiftCardImage(id: string): Promise<void> {
  const { data } = await apiClient.get<Blob>(`/gift-cards/${id}/image`, {
    responseType: 'blob',
  })
  const url = URL.createObjectURL(data)
  const link = document.createElement('a')
  link.href = url
  link.download = `gift-card-${id}.png`
  try {
    document.body.appendChild(link)
    link.click()
  } finally {
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}
