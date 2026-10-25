def test_business_profile_update_and_validation(make_account):
    a = make_account("ada@example.com", "Halden & Rye")
    body = {
        "display_name": "Halden & Rye",
        "phone": "+44 117 000 0000",
        "website": "https://halden.example",
        "city": "Bristol",
        "postcode": "BS8 4AA",
    }
    r = a.put(a.o("/business-profile"), json=body)
    assert r.status_code == 200 and r.json()["city"] == "Bristol"
    assert a.put(a.o("/business-profile"), json={**body, "website": "http://insecure.example"}).status_code == 422
    assert a.put(a.o("/business-profile"), json={**body, "phone": "call me"}).status_code == 422


def test_office_hours_replace_and_validation(make_account):
    a = make_account("ada@example.com")
    week = {
        "intervals": [{"weekday": d, "opens_at": "09:00", "closes_at": "18:00"} for d in range(1, 6)]
        + [{"weekday": 5, "opens_at": "08:30", "closes_at": "09:00"}]
    }
    r = a.put(a.o("/office-hours"), json=week)
    assert r.status_code == 200 and len(r.json()["intervals"]) == 6
    assert (
        a.put(
            a.o("/office-hours"), json={"intervals": [{"weekday": 0, "opens_at": "18:00", "closes_at": "09:00"}]}
        ).status_code
        == 422
    )
    overlap = {
        "intervals": [
            {"weekday": 2, "opens_at": "09:00", "closes_at": "13:00"},
            {"weekday": 2, "opens_at": "12:00", "closes_at": "17:00"},
        ]
    }
    assert a.put(a.o("/office-hours"), json=overlap).status_code == 422
    assert (
        a.put(
            a.o("/office-hours"), json={"intervals": [{"weekday": 7, "opens_at": "09:00", "closes_at": "10:00"}]}
        ).status_code
        == 422
    )
    # Replacing with an empty week closes the business; previous rows are gone.
    assert a.put(a.o("/office-hours"), json={"intervals": []}).json()["intervals"] == []


def test_service_catalogue_crud(make_account):
    a = make_account("ada@example.com")
    s = a.post(
        a.o("/services"),
        json={
            "name": "Full colour",
            "duration_min": 120,
            "buffer_min": 15,
            "price_from_pence": 9500,
            "requires_patch_test": True,
        },
    )
    assert s.status_code == 201
    sid = s.json()["id"]
    assert a.post(a.o("/services"), json={"name": "FULL COLOUR", "duration_min": 60}).status_code == 409
    assert a.post(a.o("/services"), json={"name": "Too long", "duration_min": 900}).status_code == 422
    assert a.patch(a.o(f"/services/{sid}"), json={"active": False}).json()["active"] is False
    assert a.get(a.o("/services")).json() == []
    assert len(a.get(a.o("/services?include_inactive=true")).json()) == 1
    assert a.delete(a.o(f"/services/{sid}")).status_code == 204
    assert a.get(a.o(f"/services/{sid}")).status_code == 404


def test_workspace_settings_validation(make_account):
    a = make_account("ada@example.com")
    assert a.patch(a.o("/settings"), json={"timezone": "Mars/Olympus"}).status_code == 422
    assert a.patch(a.o("/settings"), json={"recording_retention_days": 3}).status_code == 422
    r = a.patch(a.o("/settings"), json={"timezone": "Europe/Dublin", "recording_retention_days": 30})
    assert (
        r.status_code == 200 and r.json()["timezone"] == "Europe/Dublin" and r.json()["recording_retention_days"] == 30
    )


def test_agents_require_ai_disclosure_and_belong_to_workspace(make_account):
    a = make_account("ada@example.com")
    assert (
        a.post(a.o("/agents"), json={"name": "Rye", "greeting": "Hello, thanks for calling the studio."}).status_code
        == 422
    )
    r = a.post(a.o("/agents"), json={"name": "Rye", "greeting": "Hi, I'm Rye, the studio's AI receptionist."})
    assert r.status_code == 201
    agent = r.json()
    assert agent["created_by"] == a.user_id and agent["status"] == "draft"
    assert a.patch(a.o(f"/agents/{agent['id']}"), json={"greeting": "Hello there, how can I help?"}).status_code == 422
    assert a.patch(a.o(f"/agents/{agent['id']}"), json={"status": "paused"}).json()["status"] == "paused"
    assert a.delete(a.o(f"/agents/{agent['id']}")).status_code == 204
