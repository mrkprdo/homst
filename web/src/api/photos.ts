import { api } from "./client"

export interface PhotoEntry {
  id: string
  url: string
  selected: boolean
  created_at: string
}

export const photosApi = {
  list(): Promise<PhotoEntry[]> {
    return api.get<PhotoEntry[]>("/photos")
  },

  upload(file: File): Promise<PhotoEntry> {
    const form = new FormData()
    form.append("file", file)
    return api.upload<PhotoEntry>("/photos", form)
  },

  update(id: string, data: { selected: boolean }): Promise<PhotoEntry> {
    return api.patch<PhotoEntry>(`/photos/${id}`, data)
  },

  remove(id: string): Promise<void> {
    return api.delete<void>(`/photos/${id}`)
  },
}
