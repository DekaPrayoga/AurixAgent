# Cars

## What to look for
- **Sedan/SUV/hatchback body** — enclosed passenger vehicle
- **Four wheels** — usually 2 visible from side view
- **Windshield** — large glass front window
- **Side windows** — 2-4 windows along the side
- **Headlights/taillights** — front and rear lights
- **Doors** — visible door handles or door lines
- **License plate** — front or rear plate
- **Side mirrors** — protruding from doors

## Common false positives (DO NOT select)
- Motorcycles (2 wheels, no enclosed body)
- Buses (much larger, many more windows)
- Trucks (cargo bed, different proportions)
- Vans (no distinct trunk, boxier)
- Car parts (just a wheel, just a mirror)

## Edge cases
- Car at angle — still shows body shape + windows
- Car partially visible — count if body + at least one wheel visible
- Parked car row — each car is a separate tile target
- Car with damage/modifications — still count if recognizable as car
