import { beforeEach, describe, expect, it, vi } from "vitest"
import { flushPromises, mount } from "@vue/test-utils"
import SettingsPanel from "@/components/settings/SettingsPanel.vue"

const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>

const STATUS = {
  configured: true,
  provider: "console",
  model: "deepseek-v4.1-flash",
  key_hint: "…abcd",
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function install(handler?: (url: string, init?: RequestInit) => Response) {
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (url, init) => {
    const path = String(url)
    const method = init?.method ?? "GET"
    if (path.includes("/ai/models")) {
      return json({
        provider: "console",
        selected: "deepseek-v4.1-flash",
        models: [
          { id: "deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash", supports_images: true },
          { id: "text-only", name: "Text Only", supports_images: false },
        ],
      })
    }
    if (path.includes("/ai/test")) {
      return json({ ...STATUS, ok: true, message: "Connected" })
    }
    if (path.includes("/ai")) {
      if (method === "DELETE") return new Response(null, { status: 204 })
      if (method === "PUT") {
        const body = JSON.parse(String(init?.body))
        return json({ ...STATUS, provider: body.provider, model: body.model, key_hint: "…wxyz" })
      }
      return json(STATUS)
    }
    return handler ? handler(path, init) : json({})
  })
}

async function mountPanel() {
  const wrapper = mount(SettingsPanel)
  await flushPromises()
  return wrapper
}

function button(wrapper: ReturnType<typeof mount>, label: string) {
  return wrapper.findAll("button").find(b => b.text().includes(label))
}

beforeEach(() => {
  install()
})

describe("SettingsPanel — Smart import", () => {
  it("shows the saved key hint and saves a new key with the chosen plan", async () => {
    const wrapper = await mountPanel()
    expect(wrapper.text()).toContain("A key is saved (…abcd)")

    await wrapper.find("input.ai-key-input").setValue("oc_sk_new_key")
    await wrapper.find("select.ai-provider-select").setValue("go")
    await button(wrapper, "Save key")!.trigger("click")
    await flushPromises()

    const put = fetchMock.mock.calls.find(call => (call[1] as RequestInit)?.method === "PUT")
    expect(JSON.parse((put![1] as RequestInit).body as string)).toEqual({
      api_key: "oc_sk_new_key",
      provider: "go",
      model: "deepseek-v4.1-flash",
    })
    expect(wrapper.text()).toContain("Saved. Smart import is ready.")
    expect(wrapper.text()).toContain("…wxyz")
  })

  it("tests, then removes the key", async () => {
    const wrapper = await mountPanel()
    await button(wrapper, "Test")!.trigger("click")
    await flushPromises()
    expect(wrapper.text()).toContain("Connected")

    await button(wrapper, "Remove")!.trigger("click")
    await flushPromises()
    expect(wrapper.text()).toContain("Key removed.")
    expect(wrapper.text()).toContain("Paste a key from opencode.ai/console")
    const del = fetchMock.mock.calls.find(call => (call[1] as RequestInit)?.method === "DELETE")
    expect(String(del![0])).toContain("/ai")
  })

  it("reports save, test and remove failures", async () => {
    fetchMock.mockReset()
    fetchMock.mockImplementation(async (url, init) => {
      const method = init?.method ?? "GET"
      if (String(url).includes("/ai") && method === "PUT") return json({ detail: "bad key" }, 500)
      if (String(url).includes("/ai/test")) return json({ ...STATUS, ok: false, message: "rejected" })
      if (String(url).includes("/ai") && method === "DELETE") return json({ detail: "nope" }, 500)
      return json(STATUS)
    })
    const wrapper = await mountPanel()

    await wrapper.find("input.ai-key-input").setValue("oc_sk_bad")
    await button(wrapper, "Save key")!.trigger("click")
    await flushPromises()
    expect(wrapper.text()).toContain("bad key")

    await button(wrapper, "Test")!.trigger("click")
    await flushPromises()
    expect(wrapper.text()).toContain("rejected")

    await button(wrapper, "Remove")!.trigger("click")
    await flushPromises()
    expect(wrapper.text()).toContain("nope")
  })

  it("handles a thrown test/remove error and an unreadable status", async () => {
    fetchMock.mockReset()
    fetchMock.mockImplementation(async (url, init) => {
      const method = init?.method ?? "GET"
      if (String(url).includes("/ai/test")) throw new TypeError("offline")
      if (String(url).includes("/ai") && method === "DELETE") throw new TypeError("offline")
      return json(STATUS)
    })
    const wrapper = await mountPanel()
    await button(wrapper, "Test")!.trigger("click")
    await flushPromises()
    expect(wrapper.text()).toContain("HOMST local server is out of reach")

    await button(wrapper, "Remove")!.trigger("click")
    await flushPromises()
    expect(wrapper.text()).toContain("HOMST local server is out of reach")

    fetchMock.mockImplementation(async () => { throw new TypeError("offline") })
    const offline = await mountPanel()
    expect(offline.text()).toContain("Paste a key from opencode.ai/console")
  })

  it("saves a plan change with a blank key", async () => {
    const wrapper = await mountPanel()
    await wrapper.find("select.ai-provider-select").setValue("go")
    await button(wrapper, "Save key")!.trigger("click")
    await flushPromises()
    const put = fetchMock.mock.calls.find(call => (call[1] as RequestInit)?.method === "PUT")
    expect(JSON.parse((put![1] as RequestInit).body as string)).toEqual({
      api_key: "",
      provider: "go",
      model: "deepseek-v4.1-flash",
    })
  })

  it("lists models, warns about text-only ones and refreshes the catalog", async () => {
    const wrapper = await mountPanel()
    const select = wrapper.find("select.ai-model-select")
    expect(select.findAll("option")).toHaveLength(2)
    expect((select.element as HTMLSelectElement).value).toBe("deepseek-v4.1-flash")

    await select.setValue("text-only")
    await flushPromises()
    expect(wrapper.text()).toContain("screenshots will not work")

    const before = fetchMock.mock.calls.filter(call => String(call[0]).includes("/ai/models")).length
    await button(wrapper, "Refresh")!.trigger("click")
    await flushPromises()
    const after = fetchMock.mock.calls.filter(call => String(call[0]).includes("/ai/models")).length
    expect(after).toBe(before + 1)
    const lastModels = fetchMock.mock.calls
      .filter(call => String(call[0]).includes("/ai/models"))
      .at(-1)
    expect(String(lastModels![0])).toContain("provider=console")

    await wrapper.find("input.ai-key-input").setValue("")
    await button(wrapper, "Save key")!.trigger("click")
    await flushPromises()
    const put = fetchMock.mock.calls.find(call => (call[1] as RequestInit)?.method === "PUT")
    expect(JSON.parse((put![1] as RequestInit).body as string).model).toBe("text-only")
  })

  it("keeps a selected model that the catalog omitted", async () => {
    fetchMock.mockReset()
    fetchMock.mockImplementation(async (url) => {
      if (String(url).includes("/ai/models")) {
        return json({
          provider: "console",
          selected: "new-model",
          models: [{ id: "other", name: "Other", supports_images: true }],
        })
      }
      return json(STATUS)
    })
    const wrapper = await mountPanel()
    const select = wrapper.find("select.ai-model-select")
    expect((select.element as HTMLSelectElement).value).toBe("new-model")
    expect(select.text()).toContain("new-model")
  })

  it("reports a failed model refresh", async () => {
    fetchMock.mockReset()
    fetchMock.mockImplementation(async (url, init) => {
      const path = String(url)
      if (path.includes("/ai/models")) return json({ detail: "models unavailable" }, 500)
      if (path.includes("/ai") && (init?.method ?? "GET") === "PUT") {
        return json(STATUS)
      }
      return json(STATUS)
    })
    const wrapper = await mountPanel()
    expect(wrapper.text()).toContain("models unavailable")
  })
})
