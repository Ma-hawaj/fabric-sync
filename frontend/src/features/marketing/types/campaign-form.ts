export interface CampaignFormValues {
  body: string
}

export function createEmptyCampaignForm(): CampaignFormValues {
  return { body: '' }
}
