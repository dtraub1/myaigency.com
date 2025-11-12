# Deployment Guide - staging.myaigency.com

Complete guide to deploy myAIgency.com static site to DigitalOcean App Platform with automatic deployments from GitHub.

## Prerequisites

- GitHub account
- DigitalOcean account
- Domain registered (myaigency.com)
- Git installed locally

## Step 1: Push to GitHub

### Create GitHub Repository

1. Go to https://github.com/new
2. Repository name: `myaigency-staging`
3. Description: `myAIgency.com staging site - Static HTML/CSS/JS`
4. Visibility: **Private** (recommended for staging)
5. **Do NOT** initialize with README, .gitignore, or license
6. Click "Create repository"

### Initialize and Push

```bash
cd site

# Initialize git if not already done
git init

# Add all files
git add .

# Create initial commit
git commit -m "Initial commit: myAIgency.com v1.0.0 static site

- Complete responsive HTML/CSS/JS site
- 4 pages: Home, Services, About, Contact
- Mobile-first responsive design
- SEO optimized
- Fast performance
- No framework dependencies"

# Tag as version 1.0.0
git tag -a v1.0.0 -m "Release v1.0.0: Production-ready static site"

# Add GitHub remote (replace YOUR_USERNAME)
git remote add origin https://github.com/YOUR_USERNAME/myaigency-staging.git

# Rename branch to main if needed
git branch -M main

# Push to GitHub
git push -u origin main

# Push tags
git push origin v1.0.0
```

## Step 2: Set Up DigitalOcean App Platform

### Create App from GitHub

1. Log in to DigitalOcean: https://cloud.digitalocean.com/
2. Navigate to **Apps** in the left sidebar
3. Click **Create App**
4. Choose **GitHub** as source
5. Click **Manage Access** and authorize DigitalOcean to access your repository
6. Select your repository: `myaigency-staging`
7. Select branch: `main`
8. Enable **Autodeploy**: ✅ (deploys automatically on push)
9. Click **Next**

### Configure App Settings

#### Resources

1. Resource Type: **Static Site**
2. Name: `myaigency-static`
3. Build Command: Leave empty (or `echo "No build needed"`)
4. Output Directory: `/`
5. HTTP Routes: `/`
6. Click **Next**

#### Environment

1. Region: Select closest to your users (e.g., **New York** `nyc` or **San Francisco** `sfo`)
2. Click **Next**

#### Info

1. App Name: `myaigency-staging`
2. Project: Default or create new
3. Click **Next**

#### Review

1. Plan: **Starter** ($0/month for static sites)
2. Review settings
3. Click **Create Resources**

Wait 3-5 minutes for initial deployment to complete.

## Step 3: Configure Custom Domain (staging.myaigency.com)

### Add Domain in DigitalOcean

1. In your App dashboard, go to **Settings** tab
2. Click **Domains** section
3. Click **Add Domain**
4. Enter: `staging.myaigency.com`
5. Click **Add Domain**

DigitalOcean will show you DNS records to add:

```
Type: CNAME
Name: staging
Value: [your-app].ondigitalocean.app
TTL: 3600
```

### Configure DNS

#### Option A: Using DigitalOcean DNS (Recommended)

1. Go to **Networking** → **Domains** in DigitalOcean dashboard
2. Click **Add Domain**
3. Enter: `myaigency.com`
4. Click **Add Domain**

5. Add CNAME record:
   - Type: `CNAME`
   - Hostname: `staging`
   - Will Direct To: `[your-app].ondigitalocean.app.`
   - TTL: `3600`

6. Update nameservers at your domain registrar:
   ```
   ns1.digitalocean.com
   ns2.digitalocean.com
   ns3.digitalocean.com
   ```

#### Option B: Using External DNS Provider

Add CNAME record at your DNS provider:

```
Type: CNAME
Name: staging
Target: [your-app].ondigitalocean.app
TTL: 3600 (or Auto)
```

### Verify DNS Propagation

```bash
# Check DNS propagation
dig staging.myaigency.com

# Or use online tool
# https://www.whatsmydns.net/#CNAME/staging.myaigency.com
```

Wait up to 24-48 hours for full propagation (usually 5-15 minutes).

## Step 4: SSL Certificate (Automatic)

DigitalOcean App Platform automatically provisions **Let's Encrypt SSL certificates** for custom domains.

### Automatic SSL Setup

1. After DNS is configured correctly
2. DigitalOcean will automatically:
   - Detect your domain
   - Request Let's Encrypt certificate
   - Install and configure SSL
   - Enable HTTPS redirect

3. Certificate status in **Domains** section:
   - ⏳ Pending → DNS not propagated yet
   - ✅ Active → SSL certificate active

### Verify SSL

```bash
# Test SSL certificate
curl -I https://staging.myaigency.com

# Should show:
# HTTP/2 200
# server: nginx
```

Visit: https://staging.myaigency.com

You should see:
- 🔒 Secure padlock in browser
- Valid SSL certificate
- Automatic HTTP → HTTPS redirect

## Step 5: Set Up GitHub Secrets

For automatic deployments to work, add secrets to your GitHub repository:

1. Go to your GitHub repository
2. **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**

Add two secrets:

### Secret 1: DIGITALOCEAN_ACCESS_TOKEN

1. Name: `DIGITALOCEAN_ACCESS_TOKEN`
2. Value: Get from DigitalOcean:
   - Go to **API** → **Tokens**
   - Click **Generate New Token**
   - Name: `GitHub Actions Deploy`
   - Scopes: **Full Access** (or minimal: read/write for Apps)
   - Copy token (you won't see it again!)
   - Paste as secret value

### Secret 2: DIGITALOCEAN_APP_ID

1. Name: `DIGITALOCEAN_APP_ID`
2. Value: Get from URL:
   - Go to your App in DigitalOcean
   - Look at URL: `cloud.digitalocean.com/apps/YOUR_APP_ID`
   - Copy the APP_ID
   - Paste as secret value

## Step 6: Test Automatic Deployment

### Make a change and push

```bash
# Make a small change
echo "<!-- Deployment test -->" >> index.html

# Commit
git add .
git commit -m "Test: Verify automatic deployment"

# Push
git push origin main
```

### Monitor Deployment

1. Go to GitHub **Actions** tab
2. Watch deployment workflow run
3. Or check DigitalOcean **Deployments** tab

Deployment takes ~2-3 minutes.

## Step 7: Verify Production Site

1. Visit: https://staging.myaigency.com
2. Verify:
   - ✅ Site loads correctly
   - ✅ SSL certificate valid
   - ✅ All pages work (Home, Services, About, Contact)
   - ✅ Responsive design works
   - ✅ Images load
   - ✅ Forms work

## Deployment Workflow

### Automatic Deployments

Every push to `main` branch triggers deployment:

```bash
git add .
git commit -m "Update: [description]"
git push origin main
```

### Version Releases

Create tagged releases:

```bash
# Update version
git add .
git commit -m "Release v1.1.0: [changes]"
git tag -a v1.1.0 -m "Version 1.1.0"
git push origin main --tags
```

### Manual Deployment

Trigger deployment without code changes:

1. GitHub → **Actions** → **Deploy to DigitalOcean**
2. Click **Run workflow**
3. Select `main` branch
4. Click **Run workflow**

Or via CLI:

```bash
# Install doctl (DigitalOcean CLI)
brew install doctl  # macOS
# or download from https://docs.digitalocean.com/reference/doctl/how-to/install/

# Authenticate
doctl auth init

# Trigger deployment
doctl apps create-deployment YOUR_APP_ID
```

## Monitoring & Maintenance

### View Logs

DigitalOcean Dashboard → Your App → **Runtime Logs**

```bash
# Or via CLI
doctl apps logs YOUR_APP_ID --follow
```

### Monitor Uptime

- DigitalOcean provides 99.99% uptime SLA
- Free SSL certificate auto-renewal
- Automatic HTTPS redirect
- CDN included

### Analytics

Add Google Analytics or other analytics:

1. Edit `index.html` (and other pages)
2. Add tracking code before `</head>`
3. Commit and push

## Troubleshooting

### SSL Certificate Pending

- **Issue**: SSL shows "Pending" for >30 minutes
- **Fix**: Check DNS propagation with `dig staging.myaigency.com`
- **Wait**: Up to 24 hours for DNS propagation

### Deployment Failed

- **Check**: GitHub Actions logs
- **Verify**: Secrets are set correctly
- **Test**: `doctl auth init` and manual deployment

### Site Not Updating

- **Check**: Deployment status in DigitalOcean
- **Clear**: Browser cache (Cmd/Ctrl + Shift + R)
- **Verify**: Git commit was pushed successfully

### 404 Errors on Routes

- **Issue**: Direct URLs not working
- **Fix**: Already configured in `.do/app.yaml`:
  ```yaml
  catchall_document: index.html
  error_document: index.html
  ```

## Cost Breakdown

### DigitalOcean App Platform

- **Static Site Hosting**: $0/month (Starter plan)
- **Bandwidth**: 100 GB/month included
- **SSL Certificate**: Free (Let's Encrypt)
- **CDN**: Included
- **Custom Domain**: Free

### Total Monthly Cost: $0 🎉

## Scaling to Production

When ready to move to `www.myaigency.com`:

1. Update `.do/app.yaml`:
   ```yaml
   domain: www.myaigency.com
   ```

2. Add production secrets to GitHub

3. Deploy to production app

4. Update DNS:
   ```
   Type: CNAME
   Name: www
   Target: [prod-app].ondigitalocean.app
   ```

## Security Best Practices

✅ **HTTPS Only**: Automatic redirect configured
✅ **HSTS**: Enabled by DigitalOcean
✅ **Regular Updates**: Keep dependencies updated
✅ **Secret Management**: Use GitHub Secrets, never commit tokens
✅ **Access Control**: Private GitHub repository for staging

## Support Resources

- **DigitalOcean Docs**: https://docs.digitalocean.com/products/app-platform/
- **GitHub Actions**: https://docs.github.com/en/actions
- **SSL Issues**: https://letsencrypt.org/docs/
- **DNS Help**: https://www.digitalocean.com/community/tutorials/an-introduction-to-dns-terminology-components-and-concepts

## Quick Commands Reference

```bash
# Deploy
git push origin main

# Create release
git tag -a v1.x.x -m "Version 1.x.x"
git push origin main --tags

# View app info
doctl apps list
doctl apps get YOUR_APP_ID

# View logs
doctl apps logs YOUR_APP_ID --follow

# Manual deployment
doctl apps create-deployment YOUR_APP_ID

# Check deployment status
doctl apps list-deployments YOUR_APP_ID
```

---

## Deployment Checklist

- [ ] GitHub repository created
- [ ] Code pushed to `main` branch
- [ ] Tagged as v1.0.0
- [ ] DigitalOcean App created
- [ ] Static site configuration set
- [ ] Custom domain added (staging.myaigency.com)
- [ ] DNS CNAME record configured
- [ ] SSL certificate active
- [ ] GitHub secrets configured
- [ ] Automatic deployment tested
- [ ] Site accessible at https://staging.myaigency.com
- [ ] All pages working correctly
- [ ] Mobile responsive verified

---

**Deployment Status**: Ready for production! 🚀

For questions or issues, refer to the [README.md](README.md) or DigitalOcean support.
