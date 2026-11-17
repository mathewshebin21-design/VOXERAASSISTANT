"""Read-only authenticated billing preview endpoint.

No mutation, payment capture, webhook processing or provider credentials.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Query

from ..billing_overview import BillingOverview, read_billing_overview
from ..deps import DB, OrgContext, require
from ..permissions import Perm

router = APIRouter(prefix="/v1/orgs/{org_id}", tags=["billing"])


@router.get("/billing/overview", response_model=BillingOverview)
def billing_overview(
    ctx: Annotated[OrgContext, Depends(require(Perm.usage_read))],
    db: DB,
    month: str = Query(..., pattern=r"^(?!0000)[0-9]{4}-(0[1-9]|1[0-2])$"),
) -> BillingOverview:
    """Read a tenant-scoped billing preview for a single calendar month."""
    return read_billing_overview(db.connection(), organization_id=str(ctx.org_id), period_key=month)
