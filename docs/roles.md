# Roles and access

Application roles are Zitadel **project role keys**: `admin`, `manager`, `sales`,
`production`, and `inventory`. A user may have several roles. Sales, production,
and inventory do not imply one another. Admin can perform every listed action.
Manager can perform operational actions but cannot create or update locations,
order stages, or design options. A valid token without a recognized role can
access only its own preferences. There is no viewer role or automatic staff role.

## Zitadel setup

1. Create those five role keys in the application's Zitadel project and grant
   each user the roles they need in a trusted organization. Keep the SPA
   application and backend introspection application in this project.
2. Enable project role assertion in Zitadel and role assertion for the relevant
   application responses. The SPA requests `urn:zitadel:iam:org:projects:roles`
   and `urn:zitadel:iam:org:project:id:<project-id>:aud` automatically in addition
   to `VITE_OIDC_SCOPE`. Userinfo and introspection must return
   `urn:zitadel:iam:org:project:<project-id>:roles` as an object mapping each role
   key to an organization-ID/domain map.
3. Set backend `ZITADEL_PROJECT_ID` and `ZITADEL_ORGANIZATION_ID`, and frontend
   `VITE_ZITADEL_PROJECT_ID` and `VITE_ZITADEL_ORGANIZATION_ID` to matching values.
   Missing backend values refuse authentication setup at startup; missing frontend
   values show a configuration error. For container deployment pass the frontend
   values as Docker build arguments (or GitHub repository variables for the Docker
   workflow), and backend values as runtime environment variables. To trust external
   role assignments, set the matching comma-separated allowlists described below.
4. Sign out and sign in again after changing role scopes or grants. The frontend
   updates when the OIDC profile refreshes; the backend introspects on each request.
   The browser query cache is cleared when the identity or recognized roles change.

Backend authentication requires an active access token with the configured project
in its audience, plus `OAUTH_RESOURCE_AUDIENCE` when configured. Authorization
accepts only the explicit project role claim and a trusted organization ID.
Generic roles, Authentik groups, unknown roles, and grants from organizations
outside the allowlist provide no permissions. An invalid token returns 401; a valid token without the
required role returns 403. The frontend guards improve the UI; the API enforces
all permissions independently.

## External user role assignments

The primary `ZITADEL_ORGANIZATION_ID` is always trusted. External assignments
are opt-in: list additional organization IDs in backend
`ZITADEL_TRUSTED_ORGANIZATION_IDS` and the same IDs in frontend
`VITE_ZITADEL_TRUSTED_ORGANIZATION_IDS`. These are optional comma-separated
lists; whitespace, empty entries, and duplicates are ignored. Blank or unset
lists preserve primary-organization-only access. IDs are matched literally;
`*` does not enable all organizations.

For example:

```dotenv
# Backend runtime configuration
ZITADEL_ORGANIZATION_ID=primary-org-id
ZITADEL_TRUSTED_ORGANIZATION_IDS=partner-org-id,contractor-org-id

# Frontend build configuration
VITE_ZITADEL_ORGANIZATION_ID=primary-org-id
VITE_ZITADEL_TRUSTED_ORGANIZATION_IDS=partner-org-id,contractor-org-id
```

In Zitadel, create a project grant for the external organization, delegate the
appropriate application role keys, and assign its users to those roles through
the grant. Use the organization ID keys emitted in the project's role claim,
not email domains or organization display names. Role keys from all trusted
organizations are combined and deduplicated. A trusted external assignment
receives exactly the same permissions as a primary-organization assignment of
that role, including manager/admin privileges when those roles are granted.
Project namespacing, token audience checks, and all endpoint/field permissions
still apply.

Pass the frontend list as the Docker build argument or GitHub repository
variable of the same name. Compose passes the backend list at runtime. Rebuild
the frontend and restart the backend after changing these settings; sign in
again after changing Zitadel grants. External login authorization does not
provision users or expand the directory machine user's permissions, which also
control which people can be found in staff/assignee lookups.

## Policy source

[`frontend/src/lib/access-policy.json`](../frontend/src/lib/access-policy.json)
is the method/path policy consumed by both the backend and frontend. All entries
use paths relative to `/api`. The backend authorizes the matched route template,
not a caller-supplied concrete URL. HEAD follows GET. New endpoints are denied
until explicitly listed, even for admins. The frontend policy test checks that
all protected routes have exactly one policy entry per method.

| Workflow | Operational roles besides admin/manager |
| --- | --- |
| Customers and measurements | sales, production |
| Material lookup | sales, production, inventory |
| Material management and stock movements | inventory |
| Product lookup | sales, inventory |
| Product management and stock entry | inventory |
| Locations lookup | sales, production, inventory |
| Locations/catalog administration | admin only |
| Design options and order stages lookup | sales, production |
| Invoice create/edit/read, pricing, payments and collection | sales |
| Orders, repair lookup and slips | sales, production |
| Production location | sales, production (the order PATCH accepts only this field) |
| Stage progress | production |
| Stage assignment | manager |
| Readiness confirmation | sales, production |
| Reopen production | manager |
| Log/receive repairs | sales |
| Repair reason, charge, cancellation | sales |
| Repair production status | production |
| Repair notes and measurement fixes | sales, production |
| Return/cancellation context | sales |
| Returns, refunds, cancellations | manager |
| Gift card create/read/send | sales |
| Gift card recipient changes, void/restore | manager |
| Invoice notifications and stored documents | sales |
| Staff lookup | sales, production; email and role/group details removed |
| Full staff directory | manager |
| Own preferences | any authenticated identity |

Manager inherits each operational row. Admin inherits every row. Combined
sales/production grants permit combined commercial and production repair updates.
Received repairs still use the dedicated handover endpoint and existing business
validation. Unknown fields on order/repair PATCH payloads are rejected.

Form lookup rights are intentionally broader than write rights: invoice forms can
read customers, products, materials, locations, design options, pricing, gift cards,
and preferences without permission to administer those catalogs. Inventory forms
can read locations and preferences. Production forms can read staff, stages,
materials, locations, designs, and measurements. A role cannot gain write access
through a lookup endpoint. Current access is application-wide; no branch or
assigned-order restriction is implied.

The public exceptions remain `/health`, catalog illustration bytes at
`GET /api/design-options/:id/image`, and the WhatsApp webhook (verification token
for GET; provider signature for POST). Invoice/order/repair documents and gift
card images remain protected.

## Frontend guards

- `RoleGuard` accepts `role="sales"` or an array of alternative roles and an
  optional fallback. Manager/admin overrides follow the policy above.
- `PermissionGuard` accepts `method` and `path` and uses the shared endpoint policy.
- `PageGuard` prevents unauthorized form/page components and their queries from
  mounting, including direct links and role changes during a session.
- `RowActions` supports a per-item `permission: { method, path }` so a mixed menu
  can retain read actions while hiding forbidden mutations.

Use `canAccess`/`canVisit` for application composition. Guards and role utilities
live in shared code and do not depend on feature modules. Generated shadcn
components are unchanged.
