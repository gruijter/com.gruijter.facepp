'use strict';

module.exports = {
  // retrieve logs
  async getLogs({ homey }) {
    const result = await homey.app.getLogs();
    return result;
  },
  // delete logs
  async deleteLogs({ homey }) {
    const result = await homey.app.deleteLogs();
    return result;
  },
  // Test API key/secret against Face++
  async testApiKey({ homey, body }) {
    const result = await homey.app.testApiKey(body);
    return result;
  },
  // Detect Faces
  async detectFaces({ homey, body }) {
    const result = await homey.app.detectFaces(body.img); // body.img
    return result;
  },
  // Save Faces
  async addFace({ homey, body }) {
    const result = await homey.app.addFace(body);
    return result;
  },
  // Delete Face
  async deleteFace({ homey, body }) {
    const result = await homey.app.deleteFace(body);
    return result;
  },
  // Start an import of faces from one specific Homey's faceset - either another Homey
  // ("Import faces" button) or this Homey's own cloud set ("Import faces from cloud"
  // button). app.js's fetchForeignFaces() resolves as soon as the run has started (or
  // throws immediately if one is already running) - the run itself happens in the
  // background and is not awaited here, since it can take well over a minute, long
  // enough to trip Homey.api()'s own client-side timeout if this handler waited for the
  // whole thing to finish. Progress and the final result are logged internally (see the
  // Log tab).
  async fetchFaces({ homey, body }) {
    const result = await homey.app.fetchForeignFaces(body);
    return result;
  },
  // List every Homey (including this one) on this account
  async listFacesets({ homey }) {
    const result = await homey.app.listFacesets();
    return result;
  },
  // Face count for one outer_id, lazy-loaded per row after the list has rendered
  async getFacesetFaceCount({ homey, body }) {
    const result = await homey.app.getFacesetFaceCount(body);
    return result;
  },
  // Permanently delete another Homey's faceset
  async deleteForeignFaceset({ homey, body }) {
    const result = await homey.app.deleteForeignFaceset(body);
    return result;
  },
  // Rebuild THIS Homey's own faceset from the local face list
  // ("Rebuild" button)
  async resyncOwnFaceset({ homey }) {
    const result = await homey.app.resyncOwnFaceset();
    return result;
  },
};
