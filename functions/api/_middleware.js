import { getUserFromRequest, json } from '../_shared/auth.js';

export async function onRequest(context) {
  try {
    context.data.user = await getUserFromRequest(context.env.DB, context.request);
  } catch (err) {
    console.error('Session middleware error:', err);
    context.data.user = null;
  }
  try {
    return await context.next();
  } catch (err) {
    console.error('API error:', err);
    return json({ error: 'Eroare internă de server' }, 500);
  }
}
