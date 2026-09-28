import SwiftUI

extension Color {
    static func named(_ name: String) -> Color {
        switch name {
        case "blue": .blue
        case "green": .green
        case "red": .red
        case "orange": .orange
        case "pink": .pink
        case "purple": .purple
        case "teal": .teal
        case "indigo": .indigo
        case "yellow": .yellow
        case "mint": .mint
        default: .gray
        }
    }

    static let lineGreen = Color(red: 0.02, green: 0.78, blue: 0.33)
    static let bubbleGreen = Color(red: 0.55, green: 0.89, blue: 0.47)
    static let cardBackground = Color(nsColor: .controlBackgroundColor)
    static let pageBackground = Color(nsColor: .windowBackgroundColor)
}

/// 圓角方形的彩色圖示（側邊欄、標題、數據卡共用）
struct IconBadge: View {
    var systemName: String
    var color: Color
    var size: CGFloat = 22

    var body: some View {
        Image(systemName: systemName)
            .font(.system(size: size * 0.52, weight: .semibold))
            .foregroundStyle(.white)
            .frame(width: size, height: size)
            .background(
                RoundedRectangle(cornerRadius: size * 0.28, style: .continuous)
                    .fill(color.gradient)
            )
    }
}

struct Card<Content: View>: View {
    var padding: CGFloat = 16
    @ViewBuilder var content: Content

    var body: some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(Color.cardBackground)
                    .shadow(color: .black.opacity(0.04), radius: 2, y: 1)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .strokeBorder(Color.primary.opacity(0.06))
            )
    }
}

struct PageHeader: View {
    var section: SidebarSection
    var subtitle: String

    var body: some View {
        HStack(spacing: 12) {
            IconBadge(systemName: section.icon, color: .named(section.tint), size: 34)
            VStack(alignment: .leading, spacing: 2) {
                Text(section.title).font(.title2.bold())
                Text(subtitle).font(.subheadline).foregroundStyle(.secondary)
            }
            Spacer()
        }
    }
}

/// 頁面外框：置中、限制寬度、可捲動
struct Page<Content: View>: View {
    var section: SidebarSection
    var subtitle: String
    var maxWidth: CGFloat = 900
    @ViewBuilder var content: Content

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                PageHeader(section: section, subtitle: subtitle)
                content
            }
            .padding(28)
            .frame(maxWidth: maxWidth)
            .frame(maxWidth: .infinity)
        }
        .background(Color.pageBackground)
    }
}

struct StatTile: View {
    var icon: String
    var color: Color
    var value: String
    var label: String

    var body: some View {
        Card(padding: 14) {
            HStack(spacing: 12) {
                IconBadge(systemName: icon, color: color, size: 34)
                VStack(alignment: .leading, spacing: 0) {
                    Text(value).font(.title2.bold()).monospacedDigit()
                    Text(label).font(.caption).foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
            }
        }
    }
}

struct SectionTitle: View {
    var title: String
    var body: some View {
        Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
    }
}

struct Tag: View {
    var text: String
    var color: Color

    var body: some View {
        Text(text)
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .foregroundStyle(color)
            .background(Capsule().fill(color.opacity(0.15)))
    }
}

struct AvatarView: View {
    var name: String
    var url: String?
    var size: CGFloat = 32

    var body: some View {
        Group {
            if let url, let u = URL(string: url) {
                AsyncImage(url: u) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    initial
                }
            } else {
                initial
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
    }

    private var initial: some View {
        ZStack {
            Circle().fill(Color.purple.opacity(0.18))
            Text(String(name.first ?? "?")).font(.system(size: size * 0.42, weight: .semibold)).foregroundStyle(.purple)
        }
    }
}

struct StatusDot: View {
    var color: Color
    var body: some View {
        Circle().fill(color).frame(width: 8, height: 8)
    }
}

/// 逗號分隔的關鍵字編輯欄
struct KeywordField: View {
    var title: String
    @Binding var keywords: [String]
    @State private var text = ""

    var body: some View {
        TextField(title, text: $text, prompt: Text("用逗號分隔，例如：真人, 專人"))
            .onAppear { text = keywords.joined(separator: ", ") }
            .onChange(of: text) { _, new in
                keywords = new.split(whereSeparator: { $0 == "," || $0 == "，" || $0 == "、" })
                    .map { $0.trimmingCharacters(in: .whitespaces) }
                    .filter { !$0.isEmpty }
            }
    }
}

struct EmptyStateView: View {
    var icon: String
    var title: String
    var message: String

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: icon).font(.system(size: 34)).foregroundStyle(.tertiary)
            Text(title).font(.headline)
            Text(message).font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(30)
    }
}

extension Date {
    /// 「下午 2:09」或「10/12 下午 2:09」
    var shortDisplay: String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "zh_Hant_TW")
        f.dateFormat = Calendar.current.isDateInToday(self) ? "a h:mm" : "M/d a h:mm"
        return f.string(from: self)
    }

    var timeDisplay: String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "zh_Hant_TW")
        f.dateFormat = "a h:mm:ss"
        return f.string(from: self)
    }
}

/// 從 AppState 取某帳號資料的 Binding
extension AppState {
    func binding<T>(_ keyPath: WritableKeyPath<AccountData, T>) -> Binding<T> {
        Binding(
            get: { self.selectedData[keyPath: keyPath] },
            set: { value in self.updateSelected { $0[keyPath: keyPath] = value } }
        )
    }
}
