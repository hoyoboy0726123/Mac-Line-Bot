import SwiftUI

struct StoreInfoView: View {
    @Environment(AppState.self) private var app

    var body: some View {
        Page(section: .store, subtitle: "AI 回答時一定會參考的基本資料") {
            Card {
                Form {
                    TextField("店名", text: app.binding(\.store.name))
                    TextField("一句話介紹", text: app.binding(\.store.intro), axis: .vertical)
                    TextField("地址", text: app.binding(\.store.address))
                    TextField("電話", text: app.binding(\.store.phone))
                    TextField("網站 / 社群", text: app.binding(\.store.website))
                    TextField("付款方式", text: app.binding(\.store.payment))
                    TextField("停車資訊", text: app.binding(\.store.parking))
                }
                .formStyle(.columns)
            }
            Card {
                VStack(alignment: .leading, spacing: 6) {
                    Text("營業時間").font(.headline)
                    TextEditor(text: app.binding(\.store.businessHours))
                        .font(.body)
                        .frame(minHeight: 90)
                    Text("例如：週二至週五 9:00–20:00，每週一公休").font(.caption).foregroundStyle(.secondary)
                }
            }
            Card {
                VStack(alignment: .leading, spacing: 6) {
                    Text("其他注意事項").font(.headline)
                    TextEditor(text: app.binding(\.store.extraNotes))
                        .font(.body)
                        .frame(minHeight: 110)
                    Text("例如：寵物友善、低消規定、包場方式…").font(.caption).foregroundStyle(.secondary)
                }
            }
        }
    }
}

struct RulesView: View {
    @Environment(AppState.self) private var app

    var body: some View {
        Page(section: .rules, subtitle: "語氣、轉人工、預約與通知") {
            Card {
                VStack(alignment: .leading, spacing: 10) {
                    Text("回覆風格").font(.headline)
                    Picker("語氣", selection: app.binding(\.rules.tone)) {
                        ForEach(ReplyTone.allCases) { Text($0.label).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    Toggle("可以使用表情符號", isOn: app.binding(\.rules.useEmoji))
                    Stepper("回覆字數上限：\(app.selectedData.rules.maxReplyLength) 字", value: app.binding(\.rules.maxReplyLength), in: 50...400, step: 25)
                    LabeledTextArea(title: "加好友歡迎訊息", text: app.binding(\.rules.greetingMessage))
                    LabeledTextArea(title: "答不出來時的回覆（同時加入待補清單）", text: app.binding(\.rules.fallbackMessage))
                }
            }

            Card {
                VStack(alignment: .leading, spacing: 10) {
                    Text("轉人工").font(.headline)
                    Text("顧客要找專人、或問到不該由 AI 回的問題，AI 會停手並推播通知你。你回覆後它會自動閃開。")
                        .font(.caption).foregroundStyle(.secondary)
                    KeywordField(title: "轉人工關鍵字", keywords: app.binding(\.rules.handoffKeywords))
                    KeywordField(title: "敏感問題（AI 不回）", keywords: app.binding(\.rules.blockedKeywords))
                    LabeledTextArea(title: "轉人工時回覆顧客", text: app.binding(\.rules.handoffMessage))
                    Stepper("你回覆後 \(app.selectedData.rules.humanModeMinutes) 分鐘沒動靜，自動交還 AI", value: app.binding(\.rules.humanModeMinutes), in: 5...240, step: 5)
                }
            }

            Card {
                VStack(alignment: .leading, spacing: 10) {
                    Text("預約收單").font(.headline)
                    Toggle("啟用預約收單", isOn: app.binding(\.rules.reservationEnabled))
                    KeywordField(title: "預約關鍵字", keywords: app.binding(\.rules.reservationKeywords))
                    Toggle("詢問訂位大名", isOn: app.binding(\.rules.askName))
                    Toggle("詢問聯絡電話", isOn: app.binding(\.rules.askPhone))
                    Stepper("人數上限 \(app.selectedData.rules.maxPartySize) 位（超過轉人工）", value: app.binding(\.rules.maxPartySize), in: 1...200)
                }
            }

            Card {
                VStack(alignment: .leading, spacing: 10) {
                    Text("推播到你的 LINE").font(.headline)
                    HStack {
                        Toggle("每日摘要", isOn: app.binding(\.rules.dailySummaryEnabled))
                        Spacer()
                        Picker("", selection: app.binding(\.rules.dailySummaryHour)) {
                            ForEach(0..<24, id: \.self) { Text("\($0):00").tag($0) }
                        }
                        .labelsHidden()
                        .frame(width: 90)
                        .disabled(!app.selectedData.rules.dailySummaryEnabled)
                    }
                    HStack {
                        Toggle("待回覆提醒", isOn: app.binding(\.rules.pendingReminderEnabled))
                        Spacer()
                        Stepper("顧客等 \(app.selectedData.rules.pendingReminderMinutes) 分鐘", value: app.binding(\.rules.pendingReminderMinutes), in: 1...120)
                            .disabled(!app.selectedData.rules.pendingReminderEnabled)
                    }
                    Toggle("斷線通知", isOn: app.binding(\.rules.disconnectNotifyEnabled))
                    Toggle("AI 答不出來時通知我", isOn: app.binding(\.rules.notifyUnanswered))
                }
            }
        }
    }
}

struct LabeledTextArea: View {
    var title: String
    @Binding var text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            TextField(title, text: $text, axis: .vertical)
                .lineLimit(2...5)
                .textFieldStyle(.roundedBorder)
        }
    }
}
