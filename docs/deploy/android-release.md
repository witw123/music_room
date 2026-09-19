# Android 发布签名

最后更新：`2026-09-19`

CI 的 `release-android` 任务用固定的上传密钥签名并产出正式 APK。密钥只存在于仓库 Secret 里，仓库内不保存任何签名文件。

## 为什么必须签名

`assembleRelease` 不带签名配置时产出的是 **unsigned APK**，Android 拒绝安装；此前的流程因此改用了 `assembleDebug`，等于把 debug 包当正式版本发给用户——`BuildConfig.DEBUG` 为真会打开 Capacitor 的原生日志转发（每次原生调用及其结果都打进页面控制台），包的体积和性能也不是发布形态。

现在流程改为：缺少密钥时任务**直接失败**并给出提示，不再静默回退到 debug 包。

## 一、生成上传密钥（只做一次）

```bash
keytool -genkeypair -v \
  -keystore music-room-release.jks \
  -alias music-room \
  -keyalg RSA -keysize 4096 -validity 10000 \
  -storetype PKCS12 \
  -dname "CN=Music Room, O=Music Room, C=CN"
```

- 提示输入口令时设一个强口令。PKCS12 不支持 store 与 key 两套口令，`keyPassword` 直接回车沿用同一个即可，两个 Secret 填同样的值。
- **这个文件必须长期保管**（密码管理器 / 离线备份）。丢失后无法再对已安装的用户发升级包，只能让他们卸载重装。

## 二、添加仓库 Secrets

`Settings → Secrets and variables → Actions → New repository secret`：

| Secret | 值 |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | 密钥文件的 base64（见下） |
| `ANDROID_KEYSTORE_PASSWORD` | store 口令 |
| `ANDROID_KEY_ALIAS` | `music-room`（与 `-alias` 一致） |
| `ANDROID_KEY_PASSWORD` | key 口令（PKCS12 下同 store 口令） |

生成 base64 文本：

```bash
# Linux / Git Bash
base64 -w0 music-room-release.jks > keystore.b64

# macOS
base64 -i music-room-release.jks -o keystore.b64
```

把 `keystore.b64` 的内容整段粘进 `ANDROID_KEYSTORE_BASE64`（CI 会自行去掉换行）。

## 三、发布

打 tag 后由 `Release Apps` 工作流构建，产物为 `MusicRoom-Android-<tag>.apk`：

```bash
git tag v0.3.4 && git push origin v0.3.4
```

工作流把 tag 去掉 `v` 后作为 `ANDROID_VERSION_NAME` 传给 Gradle。`versionCode` 由版本号推导（`0.3.4 → 304`），不需要手工维护——Android 只按 `versionCode` 判断能否覆盖安装，手写数字迟早会忘记递增。旧的手写值 `33` 到 `0.3.3` 为止，`303 > 33`，已安装的包仍可继续升级。

## 四、本地构建签名包

`keystore.properties`（已在 `.gitignore` 中）放在 `apps/mobile/android/` 下：

```properties
storeFile=/绝对路径/music-room-release.jks
storePassword=……
keyAlias=music-room
keyPassword=……
```

然后 `cd apps/mobile/android && ./gradlew assembleRelease`。CI 通过环境变量 `ANDROID_KEYSTORE_PATH` 等传入同样的四个值，两者可任选其一。

## 五、换签名密钥的代价

Android 只允许签名相同的包覆盖安装。从 debug 包（历次 CI 构建各自生成调试密钥）切到正式密钥，或将来更换密钥时：

- 用户必须**先卸载旧包**才能安装新包；
- 卸载会删除应用私有目录，即 `filesDir` 下的本地曲库与 `.music-room` 仓库——**本地已下载的音乐会一起消失**。

因此更换密钥前应提示用户先备份（设置页「本地存储」可查看根目录位置），或等一次大版本一起做。
