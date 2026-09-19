import { useEffect } from 'react'

const APP_NAME = 'LiraLink'

/** Sets the browser tab title to "<title> · LiraLink" while the page is mounted. Pass undefined
 * while the title isn't known yet (e.g. a link that is still loading) to leave it unchanged. */
export function useDocumentTitle(title: string | undefined) {
  useEffect(() => {
    if (!title) return
    document.title = `${title} · ${APP_NAME}`
  }, [title])
}
