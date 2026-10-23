import { CheckIcon, MapPinIcon } from 'lucide-react'
import { toast } from 'sonner'
import {
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu'
import { useAllLocations } from '../hooks/use-locations'
import {
  usePreferences,
  useSetDefaultLocation,
} from '../hooks/use-default-location'

export function DefaultLocationMenu() {
  const { data: preferences } = usePreferences()
  const { data: locations } = useAllLocations()
  const setDefaultLocation = useSetDefaultLocation()

  const active = locations.filter((location) => location.isActive)
  const currentId = preferences?.defaultLocationId ?? null

  const change = (locationId: string | null, label: string) => {
    if (locationId === currentId) return
    const pending = setDefaultLocation.mutateAsync(locationId)
    toast.promise(pending, {
      loading: 'Saving default location...',
      success: () =>
        locationId === null
          ? 'Default location cleared.'
          : `Default location set to ${label}.`,
      error: 'Could not save the default location. Please try again.',
    })
  }

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <MapPinIcon />
        Default location
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <DropdownMenuItem onClick={() => change(null, '')}>
          <span className="flex-1">None</span>
          {currentId === null && <CheckIcon />}
        </DropdownMenuItem>
        {active.map((location) => (
          <DropdownMenuItem
            key={location.id}
            onClick={() => change(location.id, location.name)}
          >
            <span className="flex-1">{location.name}</span>
            {currentId === location.id && <CheckIcon />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}
