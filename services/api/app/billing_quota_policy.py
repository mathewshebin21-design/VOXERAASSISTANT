"""Pure billing quota arithmetic for future transactional reservation storage.

This policy is not an atomic quota allocator. Callers must lock a tenant/period
quota row and persist reservations in the same database transaction.
"""

from dataclasses import dataclass


class QuotaExceeded(ValueError):
    """A reservation would exceed the permitted quota."""


@dataclass(frozen=True)
class QuotaSnapshot:
    limit: int
    consumed: int
    reserved: int

    def __post_init__(self) -> None:
        if any(type(value) is not int or value < 0 for value in (self.limit, self.consumed, self.reserved)):
            raise ValueError("Quota values must be nonnegative integers")
        if self.consumed + self.reserved > self.limit:
            raise ValueError("Quota accounting exceeds configured limit")

    @property
    def available(self) -> int:
        return self.limit - self.consumed - self.reserved


def reserve_quota(snapshot: QuotaSnapshot, units: int) -> QuotaSnapshot:
    """Evaluate a reservation after the caller acquires an exclusive quota lock."""
    if type(units) is not int or units <= 0:
        raise ValueError("Reservation units must be a positive integer")
    if units > snapshot.available:
        raise QuotaExceeded("Insufficient remaining quota")
    return QuotaSnapshot(snapshot.limit, snapshot.consumed, snapshot.reserved + units)


def settle_quota(snapshot: QuotaSnapshot, *, reserved_units: int, consumed_units: int) -> QuotaSnapshot:
    """Release unused capacity and convert consumed reservation into settled usage."""
    if type(reserved_units) is not int or type(consumed_units) is not int:
        raise ValueError("Settlement units must be integers")
    if reserved_units <= 0 or consumed_units < 0 or consumed_units > reserved_units:
        raise ValueError("Invalid reservation settlement")
    if reserved_units > snapshot.reserved:
        raise ValueError("Reservation is not outstanding")
    return QuotaSnapshot(
        snapshot.limit,
        snapshot.consumed + consumed_units,
        snapshot.reserved - reserved_units,
    )
