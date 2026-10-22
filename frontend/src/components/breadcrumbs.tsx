import { Fragment } from 'react'
import { Link, useMatches } from '@tanstack/react-router'
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'

export function Breadcrumbs() {
  const crumbs = useMatches({
    select: (matches) => matches.filter((match) => match.staticData.title),
  })

  if (crumbs.length === 0) return null

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {crumbs.map((match, index) => {
          const isLast = index === crumbs.length - 1
          return (
            <Fragment key={match.id}>
              <BreadcrumbItem>
                {isLast ? (
                  <BreadcrumbPage>{match.staticData.title}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink
                    render={
                      <Link
                        to={match.pathname}
                        activeOptions={{ exact: true }}
                      />
                    }
                  >
                    {match.staticData.title}
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
              {!isLast && <BreadcrumbSeparator />}
            </Fragment>
          )
        })}
      </BreadcrumbList>
    </Breadcrumb>
  )
}

export default Breadcrumbs
