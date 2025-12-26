
import createOwner from './_lib/createOwner.js';
import deleteResidency from './_lib/deleteResidency.js';
import importResidents from './_lib/importResidents.js';
import ownerLogin from './_lib/ownerLogin.js';
import ownerResidencies from './_lib/ownerResidencies.js';
import registerResidency from './_lib/registerResidency.js';
import residencyStatus from './_lib/residencyStatus.js';
import toggleService from './_lib/toggleService.js';
import updateRequestStatus from './_lib/update-request-status.js';
import uploadResidentsFromPDF from './_lib/uploadResidentsFromPDF.js';

const handlers = {
  createOwner,
  deleteResidency,
  importResidents,
  ownerLogin,
  ownerResidencies,
  registerResidency,
  residencyStatus,
  toggleService,
  'update-request-status': updateRequestStatus,
  uploadResidentsFromPDF,
};

export default async function handler(req, res) {
  // Parse the route from the URL
  // Expected format: /api/<route_name>?...
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;
  
  // Extract the last segment of the path as the route name
  // e.g. /api/createOwner -> createOwner
  // e.g. /api/update-request-status -> update-request-status
  let route = pathname.split('/').pop();
  
  // Handle case where URL might be just /api (though vercel.json rewrites /api/(.*))
  if (!route || route === 'api') {
      return res.status(404).json({ error: 'API route not specified' });
  }

  // Check if handler exists
  const handlerFn = handlers[route];
  
  if (handlerFn) {
    return handlerFn(req, res);
  } else {
    return res.status(404).json({ error: `Route '${route}' not found` });
  }
}
