import React, { Component } from 'react';
import { Link } from 'react-router-dom';
import { Navbar, Nav, NavItem } from 'react-bootstrap';

class Header extends Component {
  render() {
    const pageURI = window.location.pathname;
    const component = pageURI.split('/')[1];
    return (
      <Navbar bg="light" expand="lg">
        <Navbar.Brand>YAYtears</Navbar.Brand>
        <Navbar.Toggle aria-controls="basic-navbar-nav" />
        <Navbar.Collapse id="basic-navbar-nav">
          <Nav className="mr-auto">
            <Link to="/conquest" className={"nav-item nav-link"+(component==="conquest"?" active":"")}><NavItem>Conquest</NavItem></Link>
            <Link to="/specialist" className={"nav-item nav-link"+(component==="specialist"?" active":"")}><NavItem>Specialist</NavItem></Link>
            <Link to="/battlefy" className={"nav-item nav-link"+(component==="battlefy"?" active":"")}><NavItem>Battlefy</NavItem></Link>
          </Nav>
        </Navbar.Collapse>
      </Navbar>
    );
  }
}

export default Header;