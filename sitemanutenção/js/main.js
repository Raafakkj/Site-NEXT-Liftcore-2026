document.addEventListener('DOMContentLoaded', () => {

  const inputLogin = document.getElementById('login');
  const inputPassword = document.getElementById('password');
  const loginBtn = document.querySelector('.login-btn');
  const errorMessage = document.getElementById('error-message');
  const form = document.querySelector('form');
  const rememberLogin = document.getElementById('rememberLogin');
  const savedLogin = localStorage.getItem('liftcore_saved_login');

  if (!form || !inputLogin || !inputPassword || !loginBtn || !errorMessage) return;

  if (savedLogin) {
    inputLogin.value = savedLogin;
    if (rememberLogin) rememberLogin.checked = true;
  }

  function showMessage(message) {
    errorMessage.textContent = message;
    errorMessage.style.display = 'block';
  }

  function setLoading(isLoading) {
    loginBtn.disabled = isLoading;
    loginBtn.textContent = isLoading ? 'Validando...' : 'Entrar';
    loginBtn.setAttribute('aria-busy', String(isLoading));
  }

  async function handleSubmit(e){
    e.preventDefault();

    errorMessage.style.display = 'none';

    const login = inputLogin.value.trim();
    const password = inputPassword.value.trim();

    if (login === '' || password === ''){
      showMessage('Preencha todos os campos.');
      return;
    }

    if (!window.LiftcoreApi) {
      showMessage('API local indisponível. Recarregue a página.');
      return;
    }

    setLoading(true);

    let result;
    try {
      result = await window.LiftcoreApi.authenticate(login, password);
    } catch (error) {
      console.error('Falha na API local de login.', error);
      result = { ok: false, message: 'Não foi possível validar o acesso agora.' };
    }

    if (result.ok) {
      if (rememberLogin?.checked) {
        localStorage.setItem('liftcore_saved_login', login);
      } else {
        localStorage.removeItem('liftcore_saved_login');
      }
      errorMessage.style.display = 'none';
      sessionStorage.setItem('liftcore_loading_target', './dashboard.html');
      window.location.href = './loading.html?next=dashboard.html';
      return;
    }

    setLoading(false);
    showMessage(result.message);
  }

  form.addEventListener('submit', handleSubmit);

});
