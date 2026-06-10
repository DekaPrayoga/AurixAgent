import type { Tool } from './Registry.js';

export const mapsTool: Tool = {
  name: 'maps_lookup',
  description: 'Geocoding, directions, and points of interest lookup.',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', description: 'geocode, reverse, directions, nearby' },
      query: { type: 'string', description: 'Address, coordinates, or place name' },
      origin: { type: 'string', description: 'Origin for directions' },
      destination: { type: 'string', description: 'Destination for directions' },
    },
    required: ['action', 'query'],
  },
  async execute(args) {
    const action = args.action as string;
    const query = args.query as string;

    if (action === 'geocode') {
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=3`);
        const data = await res.json() as any[];
        if (!data.length) return 'No results found.';
        return data.map((d: any) => `${d.display_name}\n  Lat: ${d.lat}, Lon: ${d.lon}`).join('\n\n');
      } catch (e: any) {
        return `Geocoding failed: ${e.message}`;
      }
    }

    if (action === 'reverse') {
      try {
        const [lat, lon] = query.split(',').map(s => s.trim());
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`);
        const data = await res.json() as any;
        return data.display_name || 'No address found.';
      } catch (e: any) {
        return `Reverse geocoding failed: ${e.message}`;
      }
    }

    if (action === 'nearby') {
      return `Nearby search for: ${query}\nUse Nominatim or Google Maps Places API for POI search.\nSet GOOGLE_MAPS_API_KEY for Google Maps integration.`;
    }

    if (action === 'directions') {
      const origin = args.origin || query;
      const destination = args.destination || '';
      return `Directions from ${origin} to ${destination}:\nUse Google Maps Directions API or OSRM for routing.\nSet GOOGLE_MAPS_API_KEY for Google Maps integration.`;
    }

    return `Unknown action: ${action}. Use: geocode, reverse, directions, nearby`;
  },
};
