import { useMutation } from '@tanstack/react-query'
import { downloadGiftCardImage } from '../lib/download-gift-card-image'

export function useDownloadGiftCardImage() {
  return useMutation({ mutationFn: downloadGiftCardImage })
}
