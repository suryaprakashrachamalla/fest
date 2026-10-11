// The organizer console lives at an unguessable path instead of /admin so it isn't found by
// casual probing. This is not access control: the path ships in the public bundle, and the
// backend still checks the ADMIN role on every /admin API call.
export const ADMIN_PATH = "/control-4f9929e9f89c4decaee55862"
