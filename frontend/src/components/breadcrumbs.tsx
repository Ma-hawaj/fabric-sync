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
  const crumbs = useMatches().filter((m) => m.staticData.title)

  console.log(JSON.stringify(crumbs, undefined, 2))

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {crumbs
          .filter((m) => m.staticData.title)
          .map((m, i) => {
            const isLast = i === crumbs.length - 1
            console.log({ isLast })
            return (
              <>
                <BreadcrumbItem key={m.pathname}>
                  {!isLast ? (
                    <BreadcrumbLink render={<Link to={m.pathname} />}>
                      {m.staticData.title}
                    </BreadcrumbLink>
                  ) : (
                    <>
                      <BreadcrumbPage>{m.staticData.title}</BreadcrumbPage>
                    </>
                  )}
                </BreadcrumbItem>
                {!isLast && <BreadcrumbSeparator />}
              </>
            )
          })}
      </BreadcrumbList>
    </Breadcrumb>
  )
}

export default Breadcrumbs
