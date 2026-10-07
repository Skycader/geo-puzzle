# Инструкции

## Как обновить Git на Windows

1. Закрыть **все** терминалы Git Bash / MSYS2 (и вкладки терминала в редакторе): пока запущен `bash.exe`, установщик не может заменить файлы Git и пишет «The following process(es) use Git for Windows».
2. Обновить одним из способов:
   - команда в терминале: `git update-git-for-windows`;
   - или скачать свежий установщик с https://git-scm.com/download/win.
3. Если установщик не отпускает процесс — нажать «Повтор» после закрытия окон. Если окно не закрывается, найти и снять процесс в PowerShell:
   ```powershell
   Get-Process bash
   taskkill /PID <PID> /F
   ```
4. Открыть новый терминал, проверить: `git --version`.

### Если `git push` в GitLab падает с ошибкой авторизации

Симптомы: `OAuth token refresh failed: invalid_request: The request utilizes more than one mechanism for authenticating the client`, либо окно `git-credential-manager.exe — Неправильная строка привязки` после «Authentication successful» в браузере. Это баг старого Git Credential Manager (2.3.x): он не может обновить или сохранить OAuth-токен GitLab. **Помогло обновление Git (см. выше).**

Если повторится:

- сбросить сохранённые данные для GitLab:
  ```bash
  printf "protocol=https\nhost=gitlab.com\n\n" | git credential reject
  ```
- затем пушить с Personal Access Token (GitLab → Preferences → Access Tokens, право `write_repository`): логин — имя пользователя GitLab, вместо пароля — токен;
- либо перейти на SSH:
  ```bash
  git remote set-url origin-gitlab git@gitlab.com:daniil.ustimencko/geo-puzzle.git
  ```
- ещё вариант: `git config --global credential.credentialStore dpapi`.

Пуш в оба remote: `git push origin master` и `git push origin-gitlab master`.

## Как отключить мерцание окна терминала (белая вспышка на Tab)

Это «визуальный звонок» (bell): терминал мигает, когда Tab не нашёл единственного продолжения. Достаточно одного из способов:

1. **В bash** (readline, звонок выключается совсем):
   ```bash
   echo 'set bell-style none' >> ~/.inputrc
   ```
   Открыть терминал заново (или для текущего окна: `bind 'set bell-style none'`).
2. **В mintty**: правый клик по заголовку окна → Options → Terminal → Bell → выключить «Flash» (при желании и «Taskbar highlight»).
